"use client";

import { OrderedHostListWithData } from "@calcom/app-store/routing-forms/components/SingleForm";
import { useLocale } from "@calcom/lib/hooks/useLocale";
import { trpc } from "@calcom/trpc";

import InsightsLayout from "./layout";

export default function InsightsPage() {
  const { t } = useLocale();

  // todo: dropdown to pick routing forms
  const { data, isLoading: isHeadersLoading } = trpc.viewer.insights.virtualQueues.useQuery({
    routingFormId: "948ae412-d995-4865-885a-48302588de03",
  });

  if (data) {
    return (
      <InsightsLayout>
        {data.map((virtualQueue, index) => (
          <OrderedHostListWithData
            key={index}
            perUserData={virtualQueue.perUserData}
            matchingMembers={virtualQueue.matchingMembers}
          />
        ))}
      </InsightsLayout>
    );
  }

  return <></>;
}
