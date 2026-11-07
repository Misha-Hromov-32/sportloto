import { Outlet } from 'react-router';

/** Без шапки и меню: печатная афиша и другие страницы «на бумагу». */
export function BareLayout() {
  return (
    <main id="main">
      <Outlet />
    </main>
  );
}
