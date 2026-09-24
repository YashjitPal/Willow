"use client";

import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AuthModal } from "./AuthModal";

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const mode = searchParams.get('mode') === 'signup' ? 'signup' : 'login';

  return (
    <div className="h-screen w-screen bg-[var(--studio-surface,#0d0d0d)] flex items-center justify-center">
      <AuthModal
        isOpen={true}
        onClose={() => navigate('/', { replace: true })}
        initialMode={mode}
      />
    </div>
  );
}

export default LoginPage;
