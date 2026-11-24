import { Suspense } from "react";
import { PrepViewPage } from "@/components/prep-view";
import { Loading } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <PrepViewPage />
    </Suspense>
  );
}
