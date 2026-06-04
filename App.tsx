import React from 'react';
import { AppShell } from './components/AppShell';
import { BudgetDashboard } from './components/BudgetDashboard';
import { ConnectPage } from './components/ConnectPage';
import { SignIn } from './components/SignIn';
import { useAuth } from './contexts/AuthContext';

const LoadingScreen: React.FC = () => (
  <div className="min-h-screen bg-[#141418] flex items-center justify-center">
    <div className="text-zinc-400 text-sm">Loading...</div>
  </div>
);

const App: React.FC = () => {
  const { user, loading: authLoading, signInWithGoogle, signOut } = useAuth();

  if (authLoading) return <LoadingScreen />;

  if (window.location.pathname === '/connect') {
    return <ConnectPage user={user} signInWithGoogle={signInWithGoogle} signOut={signOut} />;
  }

  if (!user) return <SignIn signInWithGoogle={signInWithGoogle} />;

  if (window.location.pathname === '/budget') {
    return <BudgetDashboard user={user} signOut={signOut} />;
  }

  return <AppShell user={user} signOut={signOut} />;
};

export default App;
