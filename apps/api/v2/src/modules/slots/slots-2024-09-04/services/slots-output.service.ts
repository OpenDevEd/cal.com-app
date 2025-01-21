import { EventTypesRepository_2024_06_14 } from "@/ee/event-types/event-types_2024_06_14/event-types.repository";
import { Injectable, BadRequestException } from "@nestjs/common";
import { DateTime } from "luxon";

import { SlotFormat } from "@calcom/platform-enums";
import {
  GetReservedSlotOutput_2024_09_04,
  RangeSlotsOutput_2024_09_04,
  ReserveSlotOutput_2024_09_04,
  SlotsOutput_2024_09_04,
} from "@calcom/platform-types";
import { SelectedSlots } from "@calcom/prisma/client";

type GetAvailableSlots = { slots: Record<string, { time: string }[]> };

@Injectable()
export class SlotsOutputService_2024_09_04 {
  constructor(private readonly eventTypesRepository: EventTypesRepository_2024_06_14) {}

  getOutputSlot(slot: SelectedSlots): GetReservedSlotOutput_2024_09_04 {
    return {
      eventTypeId: slot.eventTypeId,
      slotStart: DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }).toISO() || "unknown-slot-start",
      slotEnd: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).toISO() || "unknown-slot-end",
      slotDuration: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).diff(
        DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }),
        "minutes"
      ).minutes,
      reservationUid: slot.uid,
      reservationUntil:
        DateTime.fromJSDate(slot.releaseAt, { zone: "utc" }).toISO() || "unknown-reserved-until",
    };
  }

  getOutputReservedSlot(slot: SelectedSlots, reservationDuration: number): ReserveSlotOutput_2024_09_04 {
    return {
      eventTypeId: slot.eventTypeId,
      slotStart: DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }).toISO() || "unknown-slot-start",
      slotEnd: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).toISO() || "unknown-slot-end",
      slotDuration: DateTime.fromJSDate(slot.slotUtcEndDate, { zone: "utc" }).diff(
        DateTime.fromJSDate(slot.slotUtcStartDate, { zone: "utc" }),
        "minutes"
      ).minutes,
      reservationDuration,
      reservationUid: slot.uid,
      reservationUntil:
        DateTime.fromJSDate(slot.releaseAt, { zone: "utc" }).toISO() || "unknown-reserved-until",
    };
  }

  async getOutputSlots(
    availableSlots: GetAvailableSlots,
    duration?: number,
    eventTypeId?: number,
    format?: SlotFormat,
    timeZone?: string
  ): Promise<SlotsOutput_2024_09_04 | RangeSlotsOutput_2024_09_04> {
    if (!format || format === SlotFormat.Time) {
      return this.getTimeSlots(availableSlots, timeZone);
    }

    return this.getRangeSlots(availableSlots, duration, eventTypeId, timeZone);
  }

  private getTimeSlots(
    availableSlots: GetAvailableSlots,
    timeZone: string | undefined
  ): SlotsOutput_2024_09_04 {
    const slots: { [key: string]: string[] } = {};
    for (const date in availableSlots.slots) {
      slots[date] = availableSlots.slots[date].map((slot) => {
        if (!timeZone) {
          return slot.time;
        }
        const slotTimezoneAdjusted = DateTime.fromISO(slot.time, { zone: "utc" }).setZone(timeZone).toISO();
        if (!slotTimezoneAdjusted) {
          throw new BadRequestException(
            `Could not adjust timezone for slot ${slot.time} with timezone ${timeZone}`
          );
        }
        return slotTimezoneAdjusted;
      });
    }

    return slots;
  }

  private async getRangeSlots(
    availableSlots: GetAvailableSlots,
    duration?: number,
    eventTypeId?: number,
    timeZone?: string
  ): Promise<RangeSlotsOutput_2024_09_04> {
    const slotDuration = await this.getDuration(duration, eventTypeId);

    const slots = Object.entries(availableSlots.slots).reduce<
      Record<string, { start: string; end: string }[]>
    >((acc, [date, slots]) => {
      acc[date] = (slots as { time: string }[]).map((slot) => {
        if (timeZone) {
          const start = DateTime.fromISO(slot.time, { zone: "utc" }).setZone(timeZone).toISO();
          if (!start) {
            throw new BadRequestException(
              `Could not adjust timezone for slot ${slot.time} with timezone ${timeZone}`
            );
          }

          const end = DateTime.fromISO(slot.time, { zone: "utc" })
            .plus({ minutes: slotDuration })
            .setZone(timeZone)
            .toISO();

          if (!end) {
            throw new BadRequestException(
              `Could not adjust timezone for slot end time ${slot.time} with timezone ${timeZone}`
            );
          }

          return {
            start,
            end,
          };
        } else {
          const start = DateTime.fromISO(slot.time, { zone: "utc" }).toISO();
          const end = DateTime.fromISO(slot.time, { zone: "utc" }).plus({ minutes: slotDuration }).toISO();

          if (!start || !end) {
            throw new BadRequestException(`Could not create UTC time for slot ${slot.time}`);
          }

          return {
            start,
            end,
          };
        }
      });
      return acc;
    }, {});

    return slots;
  }

  private async getDuration(duration?: number, eventTypeId?: number): Promise<number> {
    if (duration) {
      return duration;
    }

    if (eventTypeId) {
      const eventType = await this.eventTypesRepository.getEventTypeById(eventTypeId);
      if (!eventType) {
        throw new Error("Event type not found");
      }
      return eventType.length;
    }

    throw new Error("duration or eventTypeId is required");
  }
}
