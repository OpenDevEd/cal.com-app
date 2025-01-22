import { useCallback, useState } from "react";

import { sdkActionManager } from "@calcom/embed-core/embed-iframe";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { useRefreshData } from "@calcom/lib/hooks/useRefreshData";
import { collectPageParameters, telemetryEventTypes, useTelemetry } from "@calcom/lib/telemetry";
import type { RecurringEvent } from "@calcom/types/Calendar";
import { Button, Icon, Label, TextArea } from "@calcom/ui";

type Props = {
  booking: {
    title?: string;
    uid?: string;
    id?: number;
  };
  profile: {
    name: string | null;
    slug: string | null;
  };
  recurringEvent: RecurringEvent | null;
  team?: string | null;
  setIsCancellationMode: (value: boolean) => void;
  theme: string | null;
  allRemainingBookings: boolean;
  seatReferenceUid?: string;
  currentUserEmail?: string;
  bookingCancelledEventProps: {
    booking: unknown;
    organizer: {
      name: string;
      email: string;
      timeZone?: string;
    };
    eventType: unknown;
  };
  isHost: boolean;
};

export default function CancelBooking(props: Props) {
  const [cancellationReason, setCancellationReason] = useState<string>("");
  const { t } = useLocale();
  const refreshData = useRefreshData();
  const { booking, allRemainingBookings, seatReferenceUid, bookingCancelledEventProps, currentUserEmail } =
    props;
  const [loading, setLoading] = useState(false);
  const telemetry = useTelemetry();
  const [error, setError] = useState<string | null>(booking ? null : t("booking_already_cancelled"));

  const cancelBookingRef = useCallback((node: HTMLTextAreaElement) => {
    if (node !== null) {
      // eslint-disable-next-line @calcom/eslint/no-scroll-into-view-embed -- CancelBooking is not usually used in embed mode
      node.scrollIntoView({ behavior: "smooth" });
      node.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      {error && (
        <div className="mt-8">
          <div className="bg-error mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <Icon name="x" className="h-6 w-6 text-red-600" />
          </div>
          <div className="mt-3 text-center sm:mt-5">
            <h3 className="text-emphasis text-lg font-medium leading-6" id="modal-title">
              {error}
            </h3>
          </div>
        </div>
      )}
      {!error && (
        <div className="mt-5 sm:mt-6">
          <Label>{props.isHost ? t("cancellation_reason_host") : t("cancellation_reason")}</Label>
          <TextArea
            data-testid="cancel_reason"
            ref={cancelBookingRef}
            placeholder={t("cancellation_reason_placeholder")}
            value={cancellationReason}
            onChange={(e) => setCancellationReason(e.target.value)}
            className="mb-4 mt-2 w-full "
            rows={3}
          />
          {props.isHost ? (
            <div className="-mt-2 mb-4 flex items-center gap-2">
              <Icon name="info" className="text-subtle h-4 w-4" />
              <p className="text-default text-subtle text-sm leading-none">
                {t("notify_attendee_cancellation_reason_warning")}
              </p>
            </div>
          ) : null}
          <div className="flex flex-col-reverse rtl:space-x-reverse ">
            <div className="ml-auto flex w-full space-x-4 ">
              <Button
                className="ml-auto"
                color="secondary"
                onClick={() => props.setIsCancellationMode(false)}>
                {t("nevermind")}
              </Button>
              <Button
                data-testid="confirm_cancel"
                disabled={props.isHost && !cancellationReason}
                onClick={async () => {
                  setLoading(true);

                  telemetry.event(telemetryEventTypes.bookingCancelled, collectPageParameters());

                  const res = await fetch("/api/cancel", {
                    body: JSON.stringify({
                      uid: booking?.uid,
                      cancellationReason: cancellationReason,
                      allRemainingBookings,
                      // @NOTE: very important this shouldn't cancel with number ID use uid instead
                      seatReferenceUid,
                      cancelledBy: currentUserEmail,
                    }),
                    headers: {
                      "Content-Type": "application/json",
                    },
                    method: "POST",
                  });

                  const bookingWithCancellationReason = {
                    ...(bookingCancelledEventProps.booking as object),
                    cancellationReason,
                  } as unknown;

                  if (res.status >= 200 && res.status < 300) {
                    // tested by apps/web/playwright/booking-pages.e2e.ts
                    sdkActionManager?.fire("bookingCancelled", {
                      ...bookingCancelledEventProps,
                      booking: bookingWithCancellationReason,
                    });
                    refreshData();
                  } else {
                    setLoading(false);
                    setError(
                      `${t("error_with_status_code_occured", { status: res.status })} ${t(
                        "please_try_again"
                      )}`
                    );
                  }
                }}
                loading={loading}>
                {props.allRemainingBookings ? t("cancel_all_remaining") : t("cancel_event")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
