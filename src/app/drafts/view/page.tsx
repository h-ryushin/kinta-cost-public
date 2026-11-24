import { Suspense } from "react";
import { RecipeViewPage } from "@/components/recipe-view";
import { Loading } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <RecipeViewPage kind="draft" />
    </Suspense>
  );
}
