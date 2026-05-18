import React from 'react';
import { AppShell } from './components/AppShell';
import { AccountKeys } from './components/AccountKeys';
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

  if (window.location.pathname === '/account/keys') {
    if (!user) return <SignIn signInWithGoogle={signInWithGoogle} />;
    return <AccountKeys user={user} signOut={signOut} />;
  }

  if (!user) return <SignIn signInWithGoogle={signInWithGoogle} />;

  return <AppShell user={user} signOut={signOut} />;
};

export default App;
