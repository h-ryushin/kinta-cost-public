import { Suspense } from "react";
import { PrepEditorPage } from "@/components/prep-editor";
import { Loading } from "@/components/ui";

export default function PrepEditPage() {
  return (
    <Suspense fallback={<Loading />}>
      <PrepEditorPage />
    </Suspense>
  );
}
