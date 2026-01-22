import React, { useState } from 'react';
import { 
  ArrowRight, 
  Building2, 
  Shapes, 
  PenTool, 
  Code2, 
  BarChart3, 
  Target, 
  Settings, 
  User,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import logo from '../src/assets/logo.png';

// Utility function for classnames
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}

const ROLES = [
  { id: 'founder', label: 'Founder', icon: Building2 },
  { id: 'product', label: 'Product', icon: Shapes },
  { id: 'designer', label: 'Designer', icon: PenTool },
  { id: 'engineer', label: 'Engineer', icon: Code2 },
  { id: 'consultant', label: 'Consultant', icon: BarChart3 },
  { id: 'marketing', label: 'Marketing / Sales', icon: Target },
  { id: 'operations', label: 'Operations', icon: Settings },
  { id: 'other', label: 'Other', icon: User },
];

interface OnboardingProps {
  onComplete: () => void;
}

export const Onboarding: React.FC<OnboardingProps> = ({ onComplete }) => {
  const { completeOnboarding, user } = useAuth();
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Pre-populate with Google account data
  React.useEffect(() => {
    if (user) {
      // Use Google displayName if available
      if (user.displayName && !name) {
        setName(user.displayName);
      }
      // Use Google photoURL if available
      if (user.photoURL && !avatar) {
        setAvatar(user.photoURL);
      }
    }
  }, [user]);

  const handleNameSubmit = () => {
    if (name.trim()) setStep(2);
  };

  const handleRoleSelect = (roleId: string) => {
    setSelectedRole(roleId);
  };

  const handleRoleSubmit = () => {
    if (selectedRole) setStep(3);
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const imageUrl = URL.createObjectURL(file);
      setAvatar(imageUrl);
    }
  };

  const handleConfirm = async () => {
    if (!selectedRole || !name.trim()) return;
    
    setIsSubmitting(true);
    try {
      // For now, we store the blob URL. In production, you'd upload to Firebase Storage first.
      await completeOnboarding(name.trim(), selectedRole, avatar);
      onComplete();
    } catch (err) {
      console.error('Error completing onboarding:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Animation variants - Fade Only, No Movement
  const pageVariants = {
    initial: { 
      opacity: 0, 
      scale: 0.98,
      filter: 'blur(10px)' 
    },
    animate: { 
      opacity: 1, 
      scale: 1,
      filter: 'blur(0px)',
      transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] }
    },
    exit: { 
      opacity: 0, 
      scale: 0.98,
      filter: 'blur(10px)',
      transition: { duration: 0.5, ease: "easeInOut" }
    }
  };

  return (
    <div className="fixed inset-0 z-[100] min-h-screen w-full bg-black flex flex-col items-center justify-center relative overflow-hidden font-sans text-white selection:bg-green-500/30">
      
      {/* Background Glow Effects - Pale Dull Willow Green */}
      <div className="absolute bottom-0 left-0 right-0 h-[50vh] bg-gradient-to-t from-[#4a5e3a]/20 via-[#6b8e55]/10 to-transparent pointer-events-none transition-all duration-1000" />
      <div className="absolute -bottom-[20%] left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-[#8ba87c]/20 blur-[120px] rounded-full pointer-events-none transition-all duration-1000" />
      
      <div className="relative z-10 w-full max-w-4xl px-6 flex flex-col items-center">
        
        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div 
              key="step1"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full max-w-md flex flex-col items-center"
            >
              {/* Logo included in animation */}
              <div className="mb-8">
                  <img src={logo} alt="Logo" className="w-16 h-16 object-contain drop-shadow-2xl opacity-90" />
              </div>

              <h1 className="text-[32px] font-bold text-white mb-10 tracking-tight text-center">
                What's your name?
              </h1>

              <div className="w-full mb-8">
                <label className="block text-[14px] font-medium text-zinc-400 mb-2 pl-1">
                  Full name
                </label>
                <div className="relative group">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleNameSubmit()}
                    placeholder="Enter your name"
                    className="w-full bg-[#1c1c1c] border border-white/10 rounded-xl px-4 py-3.5 text-white text-[16px] placeholder:text-zinc-600 outline-none ring-0 focus:outline-none focus:ring-0 focus:border-white/20 focus:bg-[#252525] transition-colors duration-300 shadow-lg"
                    autoFocus
                  />
                </div>
              </div>

              <button 
                onClick={handleNameSubmit}
                className="group relative px-8 py-3 bg-white text-black rounded-full font-semibold text-[15px] hover:bg-[#e8f5e9] transition-all active:scale-95 flex items-center gap-2 shadow-[0_0_20px_rgba(168,198,159,0.1)] hover:shadow-[0_0_25px_rgba(168,198,159,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!name.trim()}
              >
                <span>Next</span>
                <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </motion.div>
          )}

          {step === 2 && (
            <motion.div 
              key="step2"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full flex flex-col items-center"
            >
              {/* Logo included in animation */}
              <div className="mb-8">
                  <img src={logo} alt="Logo" className="w-16 h-16 object-contain drop-shadow-2xl opacity-90" />
              </div>

              <h1 className="text-[32px] font-bold text-white mb-12 tracking-tight text-center">
                Which role fits you best?
              </h1>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 w-full mb-10">
                {ROLES.map((role) => {
                  const isSelected = selectedRole === role.id;
                  return (
                    <button
                      key={role.id}
                      onClick={() => handleRoleSelect(role.id)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-4 p-6 rounded-2xl border transition-all duration-200 group h-[140px]",
                        isSelected 
                          ? "bg-[#1c1c1c] border-white ring-1 ring-white shadow-[0_0_30px_rgba(255,255,255,0.05)]" 
                          : "bg-[#161616] border-white/5 hover:bg-[#1f1f1f] hover:border-white/10"
                      )}
                    >
                      <role.icon 
                        size={24} 
                        className={cn(
                          "transition-colors duration-200",
                          isSelected ? "text-white" : "text-zinc-400 group-hover:text-white"
                        )} 
                      />
                      <span className={cn(
                        "text-[14px] font-medium transition-colors duration-200",
                        isSelected ? "text-white" : "text-zinc-400 group-hover:text-white"
                      )}>
                        {role.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-4">
                 <button 
                  onClick={() => setStep(1)}
                  className="text-zinc-500 hover:text-white text-[14px] font-medium px-4 py-2 transition-colors"
                >
                  Back
                </button>
                
                <button 
                  onClick={handleRoleSubmit}
                  className="group relative px-8 py-3 bg-white text-black rounded-full font-semibold text-[15px] hover:bg-[#e8f5e9] transition-all active:scale-95 flex items-center gap-2 shadow-[0_0_20px_rgba(168,198,159,0.1)] hover:shadow-[0_0_25px_rgba(168,198,159,0.2)] disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={!selectedRole}
                >
                  <span>Next</span>
                  <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                </button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div 
              key="step3"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full max-w-md flex flex-col items-center"
            >
              {/* Logo included in animation */}
              <div className="mb-8">
                  <img src={logo} alt="Logo" className="w-16 h-16 object-contain drop-shadow-2xl opacity-90" />
              </div>

              <h1 className="text-[32px] font-bold text-white mb-4 tracking-tight text-center">
                Add a profile picture
              </h1>
              <p className="text-zinc-400 text-[15px] mb-12 text-center max-w-xs">
                Upload a photo to help your teammates recognize you.
              </p>

              <div className="relative group mb-10 w-40 h-40">
                <div className={cn(
                  "w-full h-full rounded-full flex items-center justify-center text-5xl font-medium text-white shadow-2xl overflow-hidden transition-all duration-300 relative",
                  !avatar && "bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] shadow-[inset_0_2px_20px_rgba(255,255,255,0.15)] ring-1 ring-white/10"
                )}>
                  {avatar ? (
                    <>
                      <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                      {/* Delete Overlay */}
                      <button 
                        onClick={() => setAvatar(null)}
                        className="absolute inset-0 bg-black/60 backdrop-blur-[2px] opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all duration-300 cursor-pointer border-none"
                        title="Remove photo"
                      >
                        <Trash2 size={28} className="text-white/90 drop-shadow-lg scale-90 group-hover:scale-100 transition-transform duration-200" />
                      </button>
                    </>
                  ) : (
                    <User size={64} strokeWidth={1.5} className="text-white/90 drop-shadow-lg opacity-90" />
                  )}
                </div>
              </div>

              <div className="flex flex-col items-center gap-4 w-full">
                <div className="relative">
                  <input
                    type="file"
                    id="avatar-upload"
                    accept="image/*"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                  <label 
                    htmlFor="avatar-upload"
                    className="cursor-pointer px-6 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-[14px] font-medium hover:bg-[#1c1c1c] transition-all flex items-center gap-2 hover:border-white/20"
                  >
                    <User size={16} />
                    <span>{avatar ? 'Change photo' : 'Upload photo'}</span>
                  </label>
                </div>

                <div className="flex items-center gap-4 mt-8">
                   <button 
                    onClick={() => setStep(2)}
                    className="text-zinc-500 hover:text-white text-[14px] font-medium px-4 py-2 transition-colors"
                  >
                    Back
                  </button>
                  
                  <button 
                    onClick={() => setStep(4)}
                    className="group relative px-8 py-3 bg-white text-black rounded-full font-semibold text-[15px] hover:bg-[#e8f5e9] transition-all active:scale-95 flex items-center gap-2 shadow-[0_0_20px_rgba(168,198,159,0.1)] hover:shadow-[0_0_25px_rgba(168,198,159,0.2)]"
                  >
                    <span>{avatar ? 'Next' : 'Skip for now'}</span>
                    <ArrowRight size={18} className="group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {step === 4 && (
            <motion.div 
              key="step4"
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              className="w-full flex flex-col items-center"
            >
               {/* Logo included in animation */}
              <div className="mb-8">
                  <img src={logo} alt="Logo" className="w-16 h-16 object-contain drop-shadow-2xl opacity-90" />
              </div>

              <h1 className="text-[32px] font-bold text-white mb-8 tracking-tight text-center">
                All set?
              </h1>

              {/* Profile Card */}
              <div className="relative w-full max-w-sm">
                <div className="w-full bg-transparent backdrop-blur-xl border border-white/40 rounded-[2rem] p-8 flex flex-col items-center shadow-2xl relative overflow-hidden">
                  
                  {/* Avatar box */}
                  <div className="w-28 h-28 rounded-full mb-6 relative shadow-2xl overflow-hidden ring-1 ring-white/10 flex items-center justify-center">
                     {avatar ? (
                        <img src={avatar} alt="Profile" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gradient-to-br from-[#1e3a29] via-[#4a7c59] to-[#8fb896] flex items-center justify-center">
                           <User size={48} strokeWidth={1.5} className="text-white/90 drop-shadow-lg opacity-90" />
                        </div>
                      )}
                  </div>

                  {/* Name */}
                  <h2 className="text-[24px] font-bold text-white mb-2 tracking-tight text-center drop-shadow-sm">
                    {name}
                  </h2>

                  {/* Role */}
                  {selectedRole && (
                    <div className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/5 border border-white/5 text-zinc-300 text-[14px] font-medium mb-8 backdrop-blur-md">
                      {(() => {
                        const role = ROLES.find(r => r.id === selectedRole);
                        if (!role) return null;
                        const Icon = role.icon;
                        return (
                          <>
                            <Icon size={14} className="text-zinc-400" />
                            <span>{role.label}</span>
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* Confirm Button */}
                  <button 
                    onClick={handleConfirm}
                    disabled={isSubmitting}
                    className="w-full py-3.5 bg-white text-black rounded-xl font-bold text-[15px] hover:bg-[#e8f5e9] transition-all active:scale-[0.98] shadow-lg shadow-white/5 hover:shadow-white/10 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <span>{isSubmitting ? 'Saving...' : 'Confirm Profile'}</span>
                    {!isSubmitting && <ArrowRight size={18} />}
                  </button>

                </div>
              </div>

               <button 
                  onClick={() => setStep(3)}
                  className="mt-8 text-zinc-500 hover:text-white text-[14px] font-medium px-4 py-2 transition-colors"
                >
                  Back
                </button>

            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
};

export default Onboarding;
