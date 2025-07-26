import { Suspense, lazy } from "react";

const PhotoOrganizer = lazy(() => import("@/components/PhotoOrganizer"));

const Index = () => {
  return (
    <Suspense fallback={<div>載入中...</div>}>
      <PhotoOrganizer />
    </Suspense>
  );
};

export default Index;
