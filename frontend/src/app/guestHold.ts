let held = false;

/** Страница для гостей показывает шаг уже после входа (фото после регистрации): `GuestOnly` не уводит с неё. */
export function holdGuestPage(on: boolean): void {
  held = on;
}

export function guestPageHeld(): boolean {
  return held;
}
