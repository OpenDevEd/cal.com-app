import { isAttendeeAction } from "ee/workflows/lib/actionHelperFunctions";
import type { PartialWorkflowReminder } from "ee/workflows/lib/getWorkflowReminders";

import dayjs from "@calcom/dayjs";
import { sendSmsLimitAlmostReachedEmails, sendSmsLimitReachedEmails } from "@calcom/emails";
import { IS_SELF_HOSTED, SMS_CREDITS_PER_MEMBER } from "@calcom/lib/constants";
import { getTranslation } from "@calcom/lib/server/i18n";
import prisma from "@calcom/prisma";
import { SmsCreditAllocationType, WorkflowMethods } from "@calcom/prisma/enums";

import * as twilio from "../reminders/providers/twilioProvider";
import { smsCountryCredits } from "./countryCredits";

export const smsCreditCountSelect = {
  id: true,
  limitReached: true,
  warningSent: true,
  month: true,
  credits: true,
  overageCharges: true,
  team: {
    select: {
      id: true,
      name: true,
      smsOverageLimit: true,
      members: {
        select: {
          accepted: true,
          role: true,
          user: {
            select: {
              email: true,
              name: true,
              locale: true,
            },
          },
        },
      },
    },
  },
};

export async function getCreditsForNumber(phoneNumber: string) {
  if (IS_SELF_HOSTED) return 0;

  const countryCode = await twilio.getCountryCode(phoneNumber);

  return smsCountryCredits[countryCode] || 3;
}

export async function getTeamIdToBeCharged(userId?: number | null, teamId?: number | null) {
  if (teamId) {
    const smsCreditCountTeam = await prisma.smsCreditCount.findFirst({
      where: {
        teamId,
        userId: null,
        month: dayjs().utc().startOf("month").toDate(),
      },
      select: smsCreditCountSelect,
    });
    if (!smsCreditCountTeam?.limitReached) {
      return teamId;
    }
  } else if (userId) {
    const teamIdChargedForSMS = await getPayingTeamId(userId);
    return teamIdChargedForSMS ?? null;
  }
  return null;
}

export async function addCredits(phoneNumber: string, teamId: number, userId?: number | null) {
  //todo: teamId should also be given for managed event types and user worklfows
  const credits = await getCreditsForNumber(phoneNumber);

  if (userId) {
    // user event types
    const existingSMSCreditCountUser = await prisma.smsCreditCount.findFirst({
      where: {
        teamId,
        userId: userId,
        month: dayjs().utc().startOf("month").toDate(),
      },
    });

    if (existingSMSCreditCountUser) {
      await prisma.smsCreditCount.update({
        where: {
          id: existingSMSCreditCountUser.id,
        },
        data: {
          credits: {
            increment: credits,
          },
        },
        select: smsCreditCountSelect,
      });
    } else {
      await prisma.smsCreditCount.create({
        data: {
          teamId,
          userId,
          credits,
          month: dayjs().utc().startOf("month").toDate(),
        },
        select: smsCreditCountSelect,
      });
    }
  }

  const existingSMSCreditCountTeam = await prisma.smsCreditCount.findFirst({
    where: {
      teamId,
      userId: null,
      month: dayjs().utc().startOf("month").toDate(),
    },
  });

  let smsCreditCountTeam;

  if (existingSMSCreditCountTeam) {
    smsCreditCountTeam = await prisma.smsCreditCount.update({
      where: {
        id: existingSMSCreditCountTeam.id,
      },
      data: {
        credits: {
          increment: credits,
        },
      },
      select: smsCreditCountSelect,
    });
  } else {
    smsCreditCountTeam = await prisma.smsCreditCount.create({
      data: {
        teamId,
        credits,
        month: dayjs().utc().startOf("month").toDate(),
      },
      select: smsCreditCountSelect,
    });
  }

  const team = smsCreditCountTeam.team;

  const acceptedMembers = team.members.filter((member) => member.accepted);

  const freeCredits = acceptedMembers.length * SMS_CREDITS_PER_MEMBER;

  if (smsCreditCountTeam.credits > freeCredits) {
    if (smsCreditCountTeam.team.smsOverageLimit === 0) {
      const ownersAndAdmins = await Promise.all(
        acceptedMembers
          .filter((member) => member.role === "OWNER" || member.role === "ADMIN")
          .map(async (member) => {
            return {
              email: member.user.email,
              name: member.user.name,
              t: await getTranslation(member.user.locale ?? "en", "common"),
            };
          })
      );

      await sendSmsLimitReachedEmails({ id: team.id, name: team.name, ownersAndAdmins });

      await prisma.smsCreditCount.update({
        where: {
          id: smsCreditCountTeam.id,
        },
        data: {
          limitReached: true,
        },
      });

      // no more credits available for team, cancel all already scheduled sms and schedule emails instead
      cancelScheduledSmsAndScheduleEmails({ teamId });

      return { isFree: true }; // still allow sending last sms
    } else {
      return { isFree: false };
    }
  } else {
    const warninigLimitReached =
      smsCreditCountTeam.team.smsOverageLimit === 0
        ? smsCreditCountTeam.credits > freeCredits * 0.8
        : smsCreditCountTeam.overageCharges > smsCreditCountTeam.team.smsOverageLimit * 0.8;

    if (warninigLimitReached) {
      if (!smsCreditCountTeam.warningSent) {
        const ownersAndAdmins = await Promise.all(
          acceptedMembers
            .filter((member) => member.role === "OWNER" || member.role === "ADMIN")
            .map(async (member) => {
              return {
                email: member.user.email,
                name: member.user.name,
                t: await getTranslation(member.user.locale ?? "es", "common"),
              };
            })
        );

        // notification email to team owners that limit is almost reached
        await sendSmsLimitAlmostReachedEmails({ id: team.id, name: team.name, ownersAndAdmins });

        await prisma.smsCreditCount.update({
          where: {
            id: smsCreditCountTeam.id,
          },
          data: {
            warningSent: true,
          },
        });
      }
    }
  }
  return { isFree: true };
}

export async function getPayingTeamId(userId: number) {
  let teamMembershipsWithAvailableCredits = await prisma.membership.findMany({
    where: {
      userId,
      team: {
        smsCreditAllocationType: {
          not: SmsCreditAllocationType.NONE,
        },
        smsCreditCounts: {
          none: {
            userId: null,
            month: dayjs().utc().startOf("month").toDate(),
            limitReached: true,
          },
        },
      },
    },
    select: {
      team: {
        select: {
          id: true,
          smsCreditAllocationType: true,
          smsCreditAllocationValue: true,
          smsCreditCounts: {
            where: {
              userId,
              month: dayjs().utc().startOf("month").toDate(),
            },
            select: {
              credits: true,
            },
            take: 1,
          },
        },
      },
    },
  });

  teamMembershipsWithAvailableCredits = teamMembershipsWithAvailableCredits.filter(
    (membership) =>
      membership.team.smsCreditAllocationType === SmsCreditAllocationType.ALL ||
      (membership.team.smsCreditAllocationValue || 0) > (membership.team.smsCreditCounts[0]?.credits || 0)
  );

  //no teams of the user have credits available
  if (!teamMembershipsWithAvailableCredits.length) return null;

  const lowestCredits = Math.min(
    ...teamMembershipsWithAvailableCredits.map(
      (membership) => membership.team.smsCreditCounts[0]?.credits || 0
    )
  );

  const teamToPay = teamMembershipsWithAvailableCredits.find(
    (membership) =>
      !membership.team.smsCreditCounts.length || membership.team.smsCreditCounts[0].credits === lowestCredits
  )?.team;

  return teamToPay?.id;
}

type WorkflowReminder = PartialWorkflowReminder & {
  id: number;
  referenceId: string | null;
  method: string;
};

export async function cancelScheduledSmsAndScheduleEmails({
  teamId,
  userId,
}: {
  teamId?: number | null;
  userId?: number | null;
}) {
  const smsRemindersToCancel = await prisma.workflowReminder.findMany({
    where: {
      OR: [{ method: WorkflowMethods.SMS }, { method: WorkflowMethods.WHATSAPP }],
      scheduledDate: {
        gte: dayjs().utc().startOf("month").toDate(),
        lt: dayjs().utc().endOf("month").toDate(),
      },
      workflowStep: {
        workflow: {
          ...(userId && { userId }),
          ...(teamId && { teamId }),
        },
      },
    },
    select: { referenceId: true, id: true, workflowStep: { select: { action: true } } },
  });

  await Promise.all(
    smsRemindersToCancel.map(async (reminder) => {
      // Cancel already scheduled SMS
      if (reminder.referenceId) {
        await twilio.cancelSMS(reminder.referenceId);
      }
      if (reminder.workflowStep?.action && isAttendeeAction(reminder.workflowStep?.action))
        // Update attendee reminders to unscheduled email reminder
        await prisma.workflowReminder.update({
          where: { id: reminder.id },
          data: {
            method: WorkflowMethods.EMAIL,
            referenceId: null,
            scheduled: false,
          },
        });
    })
  );
}
