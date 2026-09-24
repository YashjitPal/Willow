"use client";

import React, { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X, ArrowLeft, Eye, EyeOff, Loader2 } from "lucide-react";
import { useAuth } from "@willow/auth/AuthContext";
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  OAuthProvider,
  signInWithPopup
} from "firebase/auth";
import { auth } from "@willow/auth/firebase";
import { useThemeMode } from "@willow/core/theme-mode";

// Willow 4-Point Star Sparkle Glyph
const WillowSparkleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 0C12 6.627 6.627 12 0 12C6.627 12 12 17.373 12 24C12 17.373 17.373 12 24 12C17.373 12 12 6.627 12 0Z"/>
  </svg>
);

// Google Icon SVG (Official colors)
const GoogleIcon = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" aria-hidden="true">
    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
  </svg>
);

// Discord Icon SVG
const DiscordIcon = ({ isLight }: { isLight?: boolean }) => (
  <svg 
    viewBox="-2 -2 20 20" 
    fill="currentColor" 
    className={`w-5 h-5 shrink-0 ${isLight ? 'text-[#5865f2]' : 'text-white'}`}
    aria-hidden="true"
  >
    <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612"/>
  </svg>
);

// Phone Icon SVG
const PhoneIcon = ({ isLight }: { isLight?: boolean }) => (
  <svg viewBox="0 0 24 24" className={`w-4 h-4 shrink-0 fill-current ${isLight ? 'text-[#1f1f1f]' : 'text-white'}`} aria-hidden="true">
    <path d="M6.62 10.79a15.053 15.053 0 006.59 6.59l2.2-2.2a1 1 0 011.02-.24c1.12.37 2.33.57 3.57.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.24.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z"/>
  </svg>
);

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'login' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'login',
}) => {
  const { isLight } = useThemeMode();
  const { user, signInWithGoogle } = useAuth();

  const [step, setStep] = useState<'initial' | 'password'>('initial');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(initialMode === 'signup');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // GeminiDialog transition choreography:
  // Enter: backdrop opacity 0 -> 1 over 400ms cubic-bezier(0.25, 0.8, 0.25, 1);
  //        surface scales 0.8 -> 1 over 150ms cubic-bezier(0, 0, 0.2, 1);
  // Exit:  surface stays scale(1) (does not animate);
  //        backdrop opacity 1 -> 0 over 125ms linear, unmounting at 125ms.
  const [shown, setShown] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen]);

  const handleDismiss = React.useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      onClose();
      setIsClosing(false);
      setShown(false);
    }, 125);
  }, [isClosing, onClose]);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  // Focus input when step changes or modal opens
  useEffect(() => {
    if (!isOpen) return;
    if (step === 'initial') {
      setTimeout(() => emailInputRef.current?.focus(), 50);
    } else if (step === 'password') {
      setTimeout(() => passwordInputRef.current?.focus(), 50);
    }
  }, [isOpen, step]);

  // Escape key listener
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleDismiss]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('initial');
      setError('');
      setSuccess('');
      setPassword('');
      setConfirmPassword('');
      setIsLoading(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleEmailContinue = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      emailInputRef.current?.focus();
      return;
    }
    if (!cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      setError('Please enter a valid email address.');
      emailInputRef.current?.focus();
      return;
    }
    setStep('password');
  };

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsLoading(true);

    try {
      if (isSignUp) {
        if (password !== confirmPassword) {
          setError('Passwords do not match.');
          setIsLoading(false);
          return;
        }
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          setIsLoading(false);
          return;
        }
        await createUserWithEmailAndPassword(auth, email.trim(), password);
        handleDismiss();
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
        handleDismiss();
      }
    } catch (err: any) {
      if (err.code === 'auth/user-not-found' || err.code === 'auth/invalid-credential') {
        setError('Incorrect email or password.');
      } else if (err.code === 'auth/wrong-password') {
        setError('Incorrect password.');
      } else if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Try logging in.');
        setIsSignUp(false);
      } else if (err.code === 'auth/invalid-email') {
        setError('Invalid email address.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters.');
      } else {
        setError(err.message || 'Authentication failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setIsLoading(true);
    try {
      await signInWithGoogle();
      handleDismiss();
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Sign-in cancelled. Please try again.');
      } else if (err.code === 'auth/popup-blocked') {
        setError('Popup was blocked by browser. Please allow popups.');
      } else {
        setError(err.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscordSignIn = async () => {
    setError('');
    setIsLoading(true);
    try {
      const provider = new OAuthProvider('discord.com');
      provider.addScope('identify');
      provider.addScope('email');
      await signInWithPopup(auth, provider);
      handleDismiss();
    } catch (err: any) {
      if (err.code === 'auth/popup-closed-by-user') {
        setError('Discord sign-in cancelled.');
      } else if (err.code === 'auth/configuration-not-found' || err.code === 'auth/operation-not-allowed') {
        setError('Discord sign-in is coming soon. Please continue with Google or Email.');
      } else {
        setError(err.message || 'Discord sign-in is coming soon. Please continue with Google or Email.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePhoneClick = () => {
    setError('Phone sign-in is coming soon. Please continue with Google or Email.');
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Please enter your email address first.');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSuccess('Password reset link sent! Check your inbox.');
      setError('');
    } catch (err: any) {
      setError(err.message || 'Failed to send password reset email.');
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleDismiss();
        }
      }}
      role="dialog"
      aria-modal="true"
    >
      {/* Background Dim - exact same in/out transition as GeminiDialog (Rename/Delete chat) */}
      <div 
        data-testid="auth-modal-backdrop"
        className="fixed inset-0 cursor-pointer"
        style={{
          background: 'rgba(0, 0, 0, 0.32)',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
          opacity: shown && !isClosing ? 1 : 0,
          transition: isClosing
            ? 'opacity 125ms linear'
            : 'opacity 0.4s cubic-bezier(0.25, 0.8, 0.25, 1)',
        }}
        onClick={handleDismiss}
        aria-hidden="true"
      />

      {/* Modal Surface - exact same in/out scale transition as GeminiDialog (Rename/Delete chat) */}
      <div 
        className={`relative z-10 w-full max-w-[448px] rounded-[28px] ${
          isLight 
            ? 'bg-[#ffffff] text-[#1f1f1f] shadow-[0_24px_64px_-12px_rgba(0,0,0,0.15)] border border-[#e3e3e3]' 
            : 'bg-[#1f1f1f] text-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.6)]'
        } p-8 font-['Google_Sans_Flex','Google_Sans',sans-serif]`}
        style={{
          transform: shown ? 'scale(1)' : 'scale(0.8)',
          transition: 'transform 150ms cubic-bezier(0, 0, 0.2, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top-right close button */}
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Close"
          className={`absolute top-5 right-5 flex h-8 w-8 items-center justify-center rounded-full ${
            isLight ? 'text-[#747775] hover:text-[#1f1f1f] hover:bg-black/5' : 'text-[#9c9c9c] hover:text-white hover:bg-white/10'
          } transition-colors`}
        >
          <X size={18} strokeWidth={2} />
        </button>

        {/* Back button when in password step */}
        {step === 'password' && (
          <button
            type="button"
            onClick={() => {
              setStep('initial');
              setError('');
              setSuccess('');
            }}
            aria-label="Go back"
            className={`absolute top-5 left-5 flex h-8 w-8 items-center justify-center rounded-full ${
              isLight ? 'text-[#747775] hover:text-[#1f1f1f] hover:bg-black/5' : 'text-[#9c9c9c] hover:text-white hover:bg-white/10'
            } transition-colors`}
          >
            <ArrowLeft size={18} strokeWidth={2} />
          </button>
        )}

        {/* Header with Willow Sparkle Glyph */}
        <div className="text-center pt-1">
          <div className="flex items-center justify-center mb-3">
            <div 
              className="relative flex items-center justify-center w-10 h-10 rounded-2xl transition-all"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--studio-accent-btn-bg, #4a7c59) 15%, transparent)',
                color: 'var(--studio-accent-btn-bg, #4a7c59)',
              }}
            >
              <WillowSparkleIcon />
            </div>
          </div>

          <h2 className={`text-[23px] font-semibold ${isLight ? 'text-[#1f1f1f]' : 'text-[#f5f5f5]'} tracking-tight leading-snug`}>
            {step === 'initial' 
              ? 'Log in or sign up' 
              : isSignUp 
                ? 'Create your password' 
                : 'Enter your password'}
          </h2>
          <p className={`mt-1.5 mb-6 text-[14px] ${isLight ? 'text-[#444746]' : 'text-[#a6a6a6]'} leading-relaxed max-w-[340px] mx-auto`}>
            {step === 'initial'
              ? 'You’ll get smarter responses and can upload files, images, and more.'
              : `Continue as ${email}`}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className={`mb-4 rounded-2xl ${isLight ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-red-500/15 text-red-200'} px-4 py-2.5 text-[13px] text-center leading-normal`}>
            {error}
          </div>
        )}

        {/* Success message */}
        {success && (
          <div className={`mb-4 rounded-2xl ${isLight ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-emerald-500/15 text-emerald-200'} px-4 py-2.5 text-[13px] text-center leading-normal`}>
            {success}
          </div>
        )}

        {step === 'initial' ? (
          <div>
            {/* OAuth Buttons */}
            <div className="flex flex-col gap-3">
              {/* Google Button */}
              <button
                type="button"
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className={`h-12 w-full rounded-full ${
                  isLight 
                    ? 'bg-[#ffffff] hover:bg-[#f0f4f9] active:bg-[#e5ebf3] text-[#1f1f1f] border border-[#c4c7c5] shadow-sm' 
                    : 'bg-[#303134] hover:bg-[#383a3e] active:bg-[#28292c] text-[#efefef]'
                } font-medium text-[15px] flex items-center justify-center gap-3 transition-colors disabled:opacity-50`}
              >
                <GoogleIcon />
                <span>Continue with Google</span>
              </button>

              {/* Discord Button */}
              <button
                type="button"
                onClick={handleDiscordSignIn}
                disabled={isLoading}
                className={`h-12 w-full rounded-full ${
                  isLight 
                    ? 'bg-[#ffffff] hover:bg-[#f0f4f9] active:bg-[#e5ebf3] text-[#1f1f1f] border border-[#c4c7c5] shadow-sm' 
                    : 'bg-[#303134] hover:bg-[#383a3e] active:bg-[#28292c] text-[#efefef]'
                } font-medium text-[15px] flex items-center justify-center gap-3 transition-colors disabled:opacity-50`}
              >
                <DiscordIcon isLight={isLight} />
                <span>Continue with Discord</span>
              </button>

              {/* Phone Button */}
              <button
                type="button"
                onClick={handlePhoneClick}
                disabled={isLoading}
                className={`h-12 w-full rounded-full ${
                  isLight 
                    ? 'bg-[#ffffff] hover:bg-[#f0f4f9] active:bg-[#e5ebf3] text-[#1f1f1f] border border-[#c4c7c5] shadow-sm' 
                    : 'bg-[#303134] hover:bg-[#383a3e] active:bg-[#28292c] text-[#efefef]'
                } font-medium text-[15px] flex items-center justify-center gap-3 transition-colors disabled:opacity-50`}
              >
                <PhoneIcon isLight={isLight} />
                <span>Continue with phone</span>
              </button>
            </div>

            {/* Divider */}
            <div className="relative my-6 flex items-center justify-center">
              <div className="absolute inset-0 flex items-center">
                <div className={`w-full border-t ${isLight ? 'border-[#e3e3e3]' : 'border-white/10'}`} />
              </div>
              <div className={`relative ${isLight ? 'bg-white text-[#747775]' : 'bg-[#1f1f1f] text-[#828282]'} px-3 text-[11px] font-medium tracking-wider uppercase`}>
                OR
              </div>
            </div>

            {/* Email form */}
            <form onSubmit={handleEmailContinue}>
              <input
                ref={emailInputRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email address"
                autoComplete="email"
                required
                className={`h-12 w-full rounded-full ${
                  isLight 
                    ? 'bg-[#ffffff] text-[#1f1f1f] placeholder:text-[#747775] border border-[#c4c7c5] focus:border-[#0b57d0]' 
                    : 'bg-[#131314] text-white placeholder:text-[#787878] focus:outline-none'
                } px-5 text-[15px] transition-all`}
              />

              <button
                type="submit"
                className={`h-12 w-full mt-3 rounded-full ${
                  isLight 
                    ? 'bg-[#0b57d0] hover:bg-[#0842a0] active:bg-[#073888] text-white shadow-sm' 
                    : 'bg-white hover:bg-[#e6e6e6] active:bg-[#d4d4d4] text-[#121212]'
                } font-semibold text-[15px] flex items-center justify-center transition-colors`}
              >
                Continue
              </button>
            </form>
          </div>
        ) : (
          /* Password Step */
          <form onSubmit={handlePasswordSubmit}>
            <div className="space-y-3">
              <div className="relative">
                <input
                  ref={passwordInputRef}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  required
                  className={`h-12 w-full rounded-full ${
                    isLight 
                      ? 'bg-[#ffffff] text-[#1f1f1f] placeholder:text-[#747775] border border-[#c4c7c5] focus:border-[#0b57d0]' 
                      : 'bg-[#131314] text-white placeholder:text-[#787878] focus:outline-none'
                  } pl-5 pr-12 text-[15px] transition-all`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className={`absolute right-4 top-1/2 -translate-y-1/2 ${
                    isLight ? 'text-[#747775] hover:text-[#1f1f1f]' : 'text-white/50 hover:text-white'
                  } transition-colors`}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {isSignUp && (
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    autoComplete="new-password"
                    required
                    className={`h-12 w-full rounded-full ${
                      isLight 
                        ? 'bg-[#ffffff] text-[#1f1f1f] placeholder:text-[#747775] border border-[#c4c7c5] focus:border-[#0b57d0]' 
                        : 'bg-[#131314] text-white placeholder:text-[#787878] focus:outline-none'
                    } px-5 text-[15px] transition-all`}
                  />
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className={`h-12 w-full mt-4 rounded-full ${
                isLight 
                  ? 'bg-[#0b57d0] hover:bg-[#0842a0] active:bg-[#073888] text-white shadow-sm' 
                  : 'bg-white hover:bg-[#e6e6e6] active:bg-[#d4d4d4] text-[#121212]'
              } font-semibold text-[15px] flex items-center justify-center transition-colors disabled:opacity-50`}
            >
              {isLoading ? (
                <Loader2 size={18} className={`animate-spin ${isLight ? 'text-white' : 'text-[#121212]'}`} />
              ) : isSignUp ? (
                'Sign up'
              ) : (
                'Log in'
              )}
            </button>

            <div className={`mt-4 flex items-center justify-between text-[13px] ${isLight ? 'text-[#444746]' : 'text-[#9c9c9c]'} px-1`}>
              {!isSignUp && (
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  className={`${isLight ? 'hover:text-[#0b57d0]' : 'hover:text-white'} underline underline-offset-2 transition-colors`}
                >
                  Forgot password?
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setIsSignUp(!isSignUp);
                  setError('');
                  setSuccess('');
                }}
                className={`${isLight ? 'hover:text-[#0b57d0]' : 'hover:text-white'} underline underline-offset-2 transition-colors ${isSignUp ? 'w-full text-center' : 'ml-auto'}`}
              >
                {isSignUp ? 'Already have an account? Log in' : "Don't have an account? Sign up"}
              </button>
            </div>
          </form>
        )}

        {/* Footer Note */}
        <div className={`mt-6 text-center text-[11px] ${isLight ? 'text-[#747775]' : 'text-[#6b6b6b]'}`}>
          Willow Studio &bull; Protected by Willow Workspace Auth
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined'
    ? createPortal(modalContent, document.body)
    : modalContent;
};
