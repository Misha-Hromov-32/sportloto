import {
  CarProfileIcon,
  CoatHangerIcon,
  ElevatorIcon,
  HandHeartIcon,
  LightbulbIcon,
  ShowerIcon,
  ToiletIcon,
  WheelchairIcon,
  WheelchairMotionIcon,
  type Icon,
} from '@phosphor-icons/react';

import type { EventAccessExtra, VenueFeature } from '@/types/domain';

export const FEATURE_ICON: Record<VenueFeature, Icon> = {
  ramp: WheelchairIcon,
  elevator: ElevatorIcon,
  accessibleToilet: ToiletIcon,
  accessibleParking: CarProfileIcon,
  lockerRoom: CoatHangerIcon,
  shower: ShowerIcon,
  lighting: LightbulbIcon,
};

export const EXTRA_ICON: Record<EventAccessExtra, Icon> = {
  escort: HandHeartIcon,
  adaptiveGear: WheelchairMotionIcon,
};
