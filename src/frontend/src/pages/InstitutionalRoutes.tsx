import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";

const LandingPage = lazy(() => import("./LandingPage"));
const PrivacyPage = lazy(() => import("./PrivacyPage"));
const TermsPage = lazy(() => import("./TermsPage"));
const GuidePage = lazy(() => import("./GuidePage"));
const GuideBudgetingPage = lazy(() => import("./GuideBudgetingPage"));
const GuideSmartImportPage = lazy(() => import("./GuideSmartImportPage"));
const GuideTelegramBotPage = lazy(() => import("./GuideTelegramBotPage"));
const GuideAIAnalysisPage = lazy(() => import("./GuideAIAnalysisPage"));
const GuideFamilyGroupsPage = lazy(() => import("./GuideFamilyGroupsPage"));
const GuideInvestmentsPage = lazy(() => import("./GuideInvestmentsPage"));
const GuideCategoriesPage = lazy(() => import("./GuideCategoriesPage"));
const GuideRecurringPage = lazy(() => import("./GuideRecurringPage"));
const ChangesPage = lazy(() => import("./ChangesPage"));
const NovedadesPage = lazy(() => import("./NovedadesPage"));

/**
 * Institutional site routes for oikonomia.ar / www.oikonomia.ar
 * Extracted from App.tsx if/return chain to use proper <Routes>.
 */
export default function InstitutionalRoutes() {
  return (
    <Suspense>
      <Routes>
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/tos" element={<TermsPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/guide/budgeting" element={<GuideBudgetingPage />} />
        <Route path="/guide/smart-import" element={<GuideSmartImportPage />} />
        <Route path="/guide/telegram-bot" element={<GuideTelegramBotPage />} />
        <Route path="/guide/ai-analysis" element={<GuideAIAnalysisPage />} />
        <Route path="/guide/family-groups" element={<GuideFamilyGroupsPage />} />
        <Route path="/guide/investments" element={<GuideInvestmentsPage />} />
        <Route path="/guide/categories" element={<GuideCategoriesPage />} />
        <Route path="/guide/recurring" element={<GuideRecurringPage />} />
        <Route path="/changes" element={<ChangesPage />} />
        <Route path="/changes/:version" element={<ChangesPage />} />
        <Route path="/novedades" element={<NovedadesPage />} />
        <Route path="*" element={<LandingPage />} />
      </Routes>
    </Suspense>
  );
}
