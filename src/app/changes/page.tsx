"use client";

import { Suspense } from "react";
import { PriceChangesPage } from "@/components/price-changes";
import { Loading } from "@/components/ui";

/** 値段の変化（D-098・D-111）。タブとページを URL で持つので Suspense の中で使う */
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PriceChangesPage />
    </Suspense>
  );
}
