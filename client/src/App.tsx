import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import DashboardLayout from "@/components/DashboardLayout";
import FinancialRoadmap from "@/pages/FinancialRoadmap";
import Home from "@/pages/Home";
import NotFound from "@/pages/NotFound";
import PortfolioWorkspace from "@/pages/PortfolioWorkspace";
import RelationshipMap from "@/pages/RelationshipMap";
import ExecutionRoadmap from "@/pages/ExecutionRoadmap";
import TeamAccess from "@/pages/TeamAccess";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

function Router() {
  return (
    <DashboardLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/portfolio" component={PortfolioWorkspace} />
        <Route path="/relationships" component={RelationshipMap} />
        <Route path="/roadmap" component={ExecutionRoadmap} />
        <Route path="/financials" component={FinancialRoadmap} />
        <Route path="/teams" component={TeamAccess} />
        <Route path="/404" component={NotFound} />
        <Route component={NotFound} />
      </Switch>
    </DashboardLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster theme="dark" richColors />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
