import '@fontsource/onest/800.css';

import { useMe } from '@/lib/api';

import { About } from './parts/About';
import { Faq, Final, LandingFooter } from './parts/Closing';
import { Communities, Questions } from './parts/Community';
import { Events } from './parts/Events';
import { Hero, SportsTicker } from './parts/Hero';
import { How } from './parts/How';
import styles from './parts/Landing.module.css';
import { Roles } from './parts/Roles';
import { SportsPattern } from './parts/SportsPattern';
import { useLandingData } from './parts/useLandingData';

const loginTo = (path: string) => `/login?to=${encodeURIComponent(path)}`;

export default function LandingPage() {
  const data = useLandingData();
  const { me, isGuest, role } = useMe();
  const createTo = isGuest ? loginTo('/events/new') : '/events/new';
  const orgTo = isGuest
    ? loginTo('/org/new')
    : role === 'admin'
      ? '/admin/organizations'
      : me?.orgs[0]
        ? `/org/${me.orgs[0].id}`
        : '/org/new';

  return (
    <div className={styles.page} data-landing="">
      <SportsPattern />
      <Hero data={data} createTo={createTo} />
      <SportsTicker data={data} />
      <About data={data} />
      <How data={data} createTo={createTo} />
      <Events key={data.city.id} data={data} createTo={createTo} />
      <Roles data={data} orgTo={orgTo} createTo={createTo} />
      <Communities data={data} />
      <Questions data={data} />
      <Faq />
      <Final data={data} createTo={createTo} />
      <LandingFooter createTo={createTo} orgTo={orgTo} isGuest={isGuest} />
    </div>
  );
}
