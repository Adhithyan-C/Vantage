import { useEffect, useState } from 'react';
import { getHealth } from '../lib/api';

export function DemoBannerContent({ demo }: { demo: boolean }) {
  if (!demo) return null;
  return (
    <div className="demo-banner" role="status">
      Demo mode: you are viewing a recorded run. No live search or AI calls are being made.
    </div>
  );
}

export function DemoBanner() {
  const [demo, setDemo] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    getHealth().then((health) => {
      if (active) setDemo(health.demo);
    }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <DemoBannerContent demo={demo === true} />;
}
