import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';

import { PageSkeleton } from '@/components';

import { GuestOnly, RequireAuth, RequireRole } from './guards';
import { AdminLayout } from './layouts/AdminLayout';
import { BareLayout } from './layouts/BareLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { ChatBoundary } from '@/pages/chat/ChatBoundary';

const LandingPage = lazy(() => import('@/pages/landing/LandingPage'));
const ChatPage = lazy(() => import('@/pages/chat/ChatPage'));
const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage'));
const ForgotPasswordPage = lazy(() => import('@/pages/auth/ForgotPasswordPage'));
const ResetPasswordPage = lazy(() => import('@/pages/auth/ResetPasswordPage'));
const EventsPage = lazy(() => import('@/pages/events/EventsPage'));
const EventPage = lazy(() => import('@/pages/events/EventPage'));
const EventCreatePage = lazy(() => import('@/pages/events/EventCreatePage'));
const EventManagePage = lazy(() => import('@/pages/events/EventManagePage'));
const EventPosterPage = lazy(() => import('@/pages/events/EventPosterPage'));
const CompanionsPage = lazy(() => import('@/pages/companions/CompanionsPage'));
const CompanionCreatePage = lazy(() => import('@/pages/companions/CompanionCreatePage'));
const MyPage = lazy(() => import('@/pages/me/MyPage'));
const StopListPage = lazy(() => import('@/pages/me/stop-list/StopListPage')); // D-16
const NotificationsPage = lazy(() => import('@/pages/notifications/NotificationsPage'));
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const AssistantPage = lazy(() => import('@/pages/settings/assistant/AssistantPage')); // В1
const OrgPublicPage = lazy(() => import('@/pages/orgs/OrgPublicPage'));
const VenuePage = lazy(() => import('@/pages/venues/VenuePage')); // В4
const OrgCreatePage = lazy(() => import('@/pages/orgs/OrgCreatePage'));
const OrgCabinetPage = lazy(() => import('@/pages/orgs/OrgCabinetPage'));
const RulesPage = lazy(() => import('@/pages/rules/RulesPage'));
const LegalPage = lazy(() => import('@/pages/legal/LegalPage'));
const InventoryPage = lazy(() => import('@/pages/inventory/InventoryPage')); // В3 + С7
const DigestPage = lazy(() => import('@/pages/events/digest/DigestPage')); // подборка дня и отписка из письма
const BotLinkPage = lazy(() => import('@/pages/bots/BotLinkPage')); // D-17: «Войти через сайт» из бота
const SharePage = lazy(() => import('@/pages/share/SharePage')); // карточка встречи для близкого, без входа
const NotFoundPage = lazy(() => import('@/pages/system/NotFoundPage'));
const AdminDashboardPage = lazy(() => import('@/pages/admin/AdminDashboardPage'));
const AdminOrganizationsPage = lazy(() => import('@/pages/admin/AdminOrganizationsPage'));
const AdminOrganizationPage = lazy(() => import('@/pages/admin/AdminOrganizationPage'));
const AdminEventsPage = lazy(() => import('@/pages/admin/AdminEventsPage'));
const AdminEventPage = lazy(() => import('@/pages/admin/AdminEventPage'));
const AdminMessagesPage = lazy(() => import('@/pages/admin/AdminMessagesPage'));
const AdminSportsPage = lazy(() => import('@/pages/admin/AdminSportsPage'));
const AdminReferencesPage = lazy(() => import('@/pages/admin/references/AdminReferencesPage'));
const AdminLogPage = lazy(() => import('@/pages/admin/AdminLogPage'));
const AdminImportsPage = lazy(() => import('@/pages/admin/imports/AdminImportsPage')); // В8
const AdminAnalyticsPage = lazy(() => import('@/pages/admin/analytics/AdminAnalyticsPage')); // В6
const AdminAssistantPage = lazy(() => import('@/pages/admin/assistant/AdminAssistantPage'));
// Оплата на сайте: возврат из банка, тестовая страница оплаты, мои деньги, покупка вещи, админка
const PayReturnPage = lazy(() => import('@/pages/payments/PayReturnPage'));
const FakePayPage = lazy(() => import('@/pages/payments/FakePayPage'));
const MyMoneyPage = lazy(() => import('@/pages/payments/MyMoneyPage'));
const OrderPage = lazy(() => import('@/pages/inventory/orders/OrderPage'));
const AdminPaymentsPage = lazy(() => import('@/pages/admin/payments/AdminPaymentsPage'));

function Page({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="container">
          <PageSkeleton />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * Карта экранов из 07-ux-ia §4. Права проверяются дважды: здесь (что показать)
 * и в domain.ts (что разрешить), поэтому прямая ссылка не обходит правила.
 */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route
          path="assistant"
          element={
            <Page>
              <ChatBoundary>
                <ChatPage />
              </ChatBoundary>
            </Page>
          }
        />
        <Route
          index
          element={
            <Page>
              <LandingPage />
            </Page>
          }
        />
        <Route
          path="login"
          element={
            <Page>
              <LoginPage />
            </Page>
          }
        />
        <Route
          path="register"
          element={
            <GuestOnly>
              <Page>
                <RegisterPage />
              </Page>
            </GuestOnly>
          }
        />
        <Route
          path="verify-email"
          element={
            <Page>
              <VerifyEmailPage />
            </Page>
          }
        />
        <Route
          path="forgot-password"
          element={
            <Page>
              <ForgotPasswordPage />
            </Page>
          }
        />
        <Route
          path="reset-password"
          element={
            <Page>
              <ResetPasswordPage />
            </Page>
          }
        />
        <Route
          path="events"
          element={
            <Page>
              <EventsPage />
            </Page>
          }
        />
        <Route
          path="events/:id"
          element={
            <Page>
              <EventPage />
            </Page>
          }
        />
        <Route
          path="companions"
          element={
            <Page>
              <CompanionsPage />
            </Page>
          }
        />
        <Route
          path="profile/:id"
          element={
            <Page>
              <ProfilePage />
            </Page>
          }
        />
        <Route
          path="orgs/:id"
          element={
            <Page>
              <OrgPublicPage />
            </Page>
          }
        />
        {/* В4: страница площадки */}
        <Route
          path="venues/:id"
          element={
            <Page>
              <VenuePage />
            </Page>
          }
        />
        <Route
          path="rules"
          element={
            <Page>
              <RulesPage />
            </Page>
          }
        />
        {/* Документы: соглашение, политика, согласия, cookie */}
        <Route
          path="legal"
          element={
            <Page>
              <LegalPage />
            </Page>
          }
        />
        <Route
          path="legal/:slug"
          element={
            <Page>
              <LegalPage />
            </Page>
          }
        />
        <Route path="demo" element={<Navigate to="/login" replace />} />
        {/* В3 + С7: общая полка инвентаря и просьбы клубов о помощи */}
        <Route
          path="inventory"
          element={
            <Page>
              <InventoryPage />
            </Page>
          }
        />
        <Route
          path="digest/:id"
          element={
            <Page>
              <DigestPage />
            </Page>
          }
        />
        <Route
          path="share/:token"
          element={
            <Page>
              <SharePage />
            </Page>
          }
        />
        <Route
          path="bots/link"
          element={
            <Page>
              <BotLinkPage />
            </Page>
          }
        />
        <Route
          path="pay/return"
          element={
            <Page>
              <PayReturnPage />
            </Page>
          }
        />

        <Route element={<RequireAuth />}>
          <Route
            path="events/:id/manage"
            element={
              <Page>
                <EventManagePage />
              </Page>
            }
          />
          <Route
            path="me"
            element={
              <Page>
                <MyPage />
              </Page>
            }
          />
          <Route
            path="me/stop-list"
            element={
              <Page>
                <StopListPage />
              </Page>
            }
          />
          <Route
            path="me/money"
            element={
              <Page>
                <MyMoneyPage />
              </Page>
            }
          />
          <Route path="me/payments" element={<Navigate to="/me/money" replace />} />
          <Route
            path="orders/:id"
            element={
              <Page>
                <OrderPage />
              </Page>
            }
          />
          <Route
            path="notifications"
            element={
              <Page>
                <NotificationsPage />
              </Page>
            }
          />
          <Route
            path="settings"
            element={
              <Page>
                <SettingsPage />
              </Page>
            }
          />
          {/* В1: подключение внешнего ассистента по MCP */}
          <Route
            path="settings/assistant"
            element={
              <Page>
                <AssistantPage />
              </Page>
            }
          />
          <Route
            path="org/:id"
            element={
              <Page>
                <OrgCabinetPage />
              </Page>
            }
          />
        </Route>

        <Route element={<RequireRole roles={['user', 'org']} />}>
          <Route
            path="events/new"
            element={
              <Page>
                <EventCreatePage />
              </Page>
            }
          />
          <Route
            path="events/:id/edit"
            element={
              <Page>
                <EventCreatePage />
              </Page>
            }
          />
          <Route
            path="companions/new"
            element={
              <Page>
                <CompanionCreatePage />
              </Page>
            }
          />
          <Route
            path="org/new"
            element={
              <Page>
                <OrgCreatePage />
              </Page>
            }
          />
        </Route>

        <Route
          path="*"
          element={
            <Page>
              <NotFoundPage />
            </Page>
          }
        />
      </Route>

      <Route element={<BareLayout />}>
        <Route
          path="events/:id/poster"
          element={
            <Page>
              <EventPosterPage />
            </Page>
          }
        />
        <Route
          path="pay/fake/:paymentId"
          element={
            <Page>
              <FakePayPage />
            </Page>
          }
        />
      </Route>

      <Route path="admin" element={<AdminLayout />}>
        <Route
          path="references"
          element={
            <Page>
              <AdminReferencesPage />
            </Page>
          }
        />
        <Route
          index
          element={
            <Page>
              <AdminDashboardPage />
            </Page>
          }
        />
        <Route
          path="organizations"
          element={
            <Page>
              <AdminOrganizationsPage />
            </Page>
          }
        />
        <Route
          path="organizations/:id"
          element={
            <Page>
              <AdminOrganizationPage />
            </Page>
          }
        />
        <Route
          path="events"
          element={
            <Page>
              <AdminEventsPage />
            </Page>
          }
        />
        <Route
          path="events/:id"
          element={
            <Page>
              <AdminEventPage />
            </Page>
          }
        />
        <Route
          path="messages"
          element={
            <Page>
              <AdminMessagesPage />
            </Page>
          }
        />
        <Route
          path="sports"
          element={
            <Page>
              <AdminSportsPage />
            </Page>
          }
        />
        <Route
          path="log"
          element={
            <Page>
              <AdminLogPage />
            </Page>
          }
        />
        {/* В8, В6: посты сообществ, спрос и инфраструктура */}
        <Route
          path="imports"
          element={
            <Page>
              <AdminImportsPage />
            </Page>
          }
        />
        <Route
          path="analytics"
          element={
            <Page>
              <AdminAnalyticsPage />
            </Page>
          }
        />
        <Route
          path="assistant"
          element={
            <Page>
              <AdminAssistantPage />
            </Page>
          }
        />
        <Route
          path="payments"
          element={
            <Page>
              <AdminPaymentsPage />
            </Page>
          }
        />
        <Route
          path="*"
          element={
            <Page>
              <NotFoundPage />
            </Page>
          }
        />
      </Route>
    </Routes>
  );
}
