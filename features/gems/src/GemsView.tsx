import React, { useState, useRef, useEffect } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';

interface GemCardProps {
  title: string;
  description: string;
  icon: string;
  iconColor: string;
  iconBg: string;
  isExperiment?: boolean;
}

interface MenuItem {
  icon?: string;
  label: string;
}

const MY_GEM_MENU_ITEMS: MenuItem[] = [
  { icon: 'chat_bubble', label: 'New chat' },
  { icon: 'content_copy', label: 'Make a copy' },
  { icon: 'drive_search', label: 'Locate Gem in Drive' },
  { icon: 'delete', label: 'Delete' },
];

const PREMADE_GEM_MENU_ITEMS: MenuItem[] = [
  { icon: 'content_copy', label: 'Make a copy' }
];

const ActionButton: React.FC<{ icon: string; onClick?: () => void; title?: string }> = ({ icon, onClick, title }) => {
  const [isHovered, setIsHovered] = useState(false);
  return (
    <button
      title={title}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
      className="transition-colors duration-200"
      style={{
        width: '40px',
        height: '40px',
        borderRadius: '50%',
        backgroundColor: isHovered ? 'rgb(55, 57, 59)' : 'transparent',
        border: 'none',
        color: 'rgb(196, 199, 197)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        padding: '8px',
        margin: '0px'
      }}
    >
      <MaterialSymbol name={icon} size={20} family="google-symbols" variationSettings="normal" style={{ fontWeight: 400 }} />
    </button>
  );
};

const OverflowMenuButton: React.FC<{ items: MenuItem[]; isPremade?: boolean }> = ({ items, isPremade = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const closeMenu = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setIsClosing(false);
    }, 120); // Material menu exact exit duration (120ms)
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node) && btnRef.current && !btnRef.current.contains(event.target as Node)) {
        closeMenu();
      }
    };
    if (isOpen && !isClosing) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, isClosing]);

  const buttonSize = isPremade ? '32px' : '40px';
  const buttonPadding = isPremade ? '0px' : '8px';
  const iconColor = isPremade ? 'rgb(196, 199, 197)' : 'rgb(227, 227, 227)';

  const [isBtnHovered, setIsBtnHovered] = useState(false);
  const [hoveredItemIndex, setHoveredItemIndex] = useState<number | null>(null);

  return (
    <div style={{ position: 'relative', display: 'flex' }}>
      <button
        ref={btnRef}
        onMouseEnter={() => setIsBtnHovered(true)}
        onMouseLeave={() => setIsBtnHovered(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (isOpen) {
            closeMenu();
          } else {
            setIsOpen(true);
          }
        }}
        className="transition-colors duration-200"
        style={{
          width: buttonSize,
          height: buttonSize,
          borderRadius: '50%',
          backgroundColor: isBtnHovered ? 'rgb(55, 57, 59)' : 'transparent',
          border: 'none',
          color: iconColor,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          padding: buttonPadding,
          margin: '0px'
        }}
      >
        <MaterialSymbol name="more_vert" size={20} family="google-symbols" variationSettings="normal" style={{ fontWeight: 400 }} />
      </button>
      {isOpen && items.length > 0 && (
        <div
          ref={menuRef}
          className={`gem-menu-panel ${isClosing ? 'gem-menu-panel-exit' : ''}`}
          style={{
            position: 'absolute',
            top: '100%',
            left: '0',
            zIndex: 100,
            backgroundColor: 'rgb(30, 31, 32)',
            borderRadius: '8px',
            padding: '0px',
            boxShadow: 'rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px',
            minWidth: '112px',
            maxWidth: '280px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            transformOrigin: 'left top'
          }}
        >
          {items.map((item, index) => (
            <button
              key={index}
              onMouseEnter={() => setHoveredItemIndex(index)}
              onMouseLeave={() => setHoveredItemIndex(null)}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                closeMenu();
              }}
              className="transition-colors duration-200"
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0px 12px',
                minHeight: '48px',
                backgroundColor: hoveredItemIndex === index ? 'rgba(227, 227, 227, 0.08)' : 'transparent',
                border: 'none',
                width: '100%',
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              {item.icon && (
                <MaterialSymbol 
                  name={item.icon} 
                  size={24} 
                  family="google-symbols" 
                  variationSettings="normal" 
                  style={{ fontWeight: 400, color: 'rgb(196, 199, 197)', margin: '0px 12px 0px 0px' }} 
                />
              )}
              <span
                style={{
                  color: 'rgb(227, 227, 227)',
                  fontSize: '14px',
                  fontWeight: 400,
                  fontFamily: '"Google Sans Flex", "Google Sans", Roboto, Arial, sans-serif',
                  letterSpacing: '0.25px',
                  whiteSpace: 'nowrap'
                }}
              >
                {item.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const PREMADE_GEMS: GemCardProps[] = [
  {
    title: 'Chess champ',
    description: 'Play chess with a language model. Make your first ',
    icon: 'chess', // generic placeholder for chess icon if custom not available, but user wants material symbols
    iconColor: 'rgb(216, 152, 0)',
    iconBg: 'rgb(79, 53, 0)',
    isExperiment: true,
  },
  {
    title: 'Career guide',
    description: 'Unlock your career potential. Get a detailed plan ',
    icon: 'work',
    iconColor: 'rgb(219, 141, 167)',
    iconBg: 'rgb(96, 38, 61)',
  },
  {
    title: 'Storybook',
    description: 'Create a customized picture book, for either child',
    icon: 'auto_stories',
    iconColor: 'rgb(96, 169, 237)',
    iconBg: 'rgb(0, 61, 100)',
  },
  {
    title: 'Learning coach',
    description: 'Here to help you learn and practice new concepts. ',
    icon: 'school',
    iconColor: 'rgb(236, 140, 76)',
    iconBg: 'rgb(97, 43, 0)',
  },
  {
    title: 'Brainstormer',
    description: 'Find inspiration easily. Fresh ideas for parties, ',
    icon: 'lightbulb',
    iconColor: 'rgb(200, 142, 225)',
    iconBg: 'rgb(85, 34, 110)',
  },
  {
    title: 'Coding partner',
    description: 'Level up your coding skills. Get the help you need',
    icon: 'code',
    iconColor: 'rgb(37, 178, 212)',
    iconBg: 'rgb(0, 64, 78)',
  },
];

const GemCard: React.FC<GemCardProps> = ({ title, description, icon, iconColor, iconBg, isExperiment }) => {
  return (
    <div
      style={{
        position: 'relative',
        width: '200px',
        height: '176px',
        backgroundColor: 'rgb(30, 31, 32)',
        borderRadius: '16px',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
        cursor: 'pointer',
      }}
    >
      <div style={{ position: 'absolute', top: '8px', right: '8px' }}>
        <OverflowMenuButton items={PREMADE_GEM_MENU_ITEMS} isPremade={true} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'row', marginBottom: '16px', height: '28px', paddingRight: '24px' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '50%',
            backgroundColor: iconBg,
            color: iconColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <MaterialSymbol name={icon} fill={true} weight={500} style={{ fontSize: '15.75px' }} />
        </div>
        {isExperiment && (
          <div style={{ paddingLeft: '8px', display: 'flex', alignItems: 'center' }}>
            <span
              style={{
                display: 'inline-block',
                padding: '1px 8px',
                borderRadius: '34px',
                fontSize: '15px',
                fontWeight: 370,
                fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                color: 'rgb(227, 227, 227)',
                backgroundColor: 'rgba(0, 0, 0, 0)', // Looks like the badge itself is bordered in actual UI, but the JSON says bg is transparent and no border. Let's add a border matching gemini if needed, but going strictly by JSON:
                border: '1px solid rgb(68, 71, 70)', // adding a standard border for gemini chips to make it visible
                lineHeight: '20px'
              }}
            >
              Experiment
            </span>
          </div>
        )}
      </div>

      <div
        style={{
          fontSize: '13px',
          fontWeight: 400,
          fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
          color: 'rgb(227, 227, 227)',
          marginBottom: '4px',
        }}
      >
        {title}
      </div>

      <div
        style={{
          fontSize: '12px',
          fontWeight: 400,
          fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
          color: 'rgb(196, 199, 197)',
          display: 'flow-root',
          lineHeight: '1.4',
        }}
      >
        {description}
      </div>
    </div>
  );
};

export const GemsView: React.FC = () => {
  const [premadeExpanded, setPremadeExpanded] = useState(false);
  const [showSharedGemsInfo, setShowSharedGemsInfo] = useState(false);

  return (
    <>
      <style>{`
        @keyframes _mat-menu-enter {
          0% { opacity: 0; transform: scale(0.8); }
          100% { opacity: 1; transform: none; }
        }
        @keyframes _mat-menu-exit {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
        .gem-menu-panel {
          animation: 0.12s cubic-bezier(0, 0, 0.2, 1) _mat-menu-enter;
        }
        .gem-menu-panel-exit {
          animation: 0.12s linear _mat-menu-exit forwards;
        }
      `}</style>
      <div className="h-full w-full overflow-y-auto" style={{ backgroundColor: '#131314' }}>
        <div
        style={{
          width: '878px',
          padding: '24px',
          margin: '0 auto',
          boxSizing: 'border-box',
          color: 'rgb(227, 227, 227)',
          fontFamily: '"Times New Roman"',
        }}
      >
        <h1
          style={{
            fontSize: '24px',
            fontWeight: 380,
            fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
            margin: '16.08px 0px',
            color: 'rgb(227, 227, 227)',
          }}
        >
          Gem manager
        </h1>

        <section style={{ width: '830px' }}>
          <div 
            className="group/premade-header"
            style={{ 
              display: 'flex', 
              flexDirection: 'row', 
              marginBottom: '4px', 
              height: '45px',
              alignItems: 'center',
              cursor: 'pointer'
            }}
            onClick={() => setPremadeExpanded(!premadeExpanded)}
          >
            <h2
              style={{
                fontSize: '15px',
                fontWeight: 500,
                fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                margin: '12.45px 0px',
                color: 'rgb(227, 227, 227)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              Premade by Google
              <span
                className="luminous-symbols transition-opacity duration-200 opacity-0 group-hover/premade-header:opacity-100"
                style={{
                  fontFamily: "'Luminous Symbols', sans-serif",
                  fontWeight: 330,
                  fontVariationSettings: '"FILL" 0, "wght" 330, "GRAD" 0, "opsz" 16, "ROND" 100',
                  fontSize: '16px',
                  color: 'rgb(196, 199, 197)'
                }}
              >
                {premadeExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
              </span>
            </h2>
          </div>

          <div 
            style={{ 
              display: 'flex', 
              flexDirection: 'row', 
              gap: '10px', 
              flexWrap: 'wrap',
              overflow: 'hidden',
              maxHeight: premadeExpanded ? '362px' : '176px',
              transition: 'max-height 300ms cubic-bezier(0.2, 0, 0, 1)'
            }}
          >
            {PREMADE_GEMS.map((gem, index) => (
              <GemCard key={index} {...gem} />
            ))}
          </div>
        </section>

        {/* My Gems Section */}
        <section style={{ width: '830px', display: 'flex', flexDirection: 'column', marginBottom: '48px' }}>
          <div style={{ display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', height: '45px', margin: '16px 0px' }}>
            <div style={{ display: 'flex', flexDirection: 'row', gap: '8px', alignItems: 'center', position: 'relative' }}>
              <h2
                style={{
                  fontSize: '15px',
                  fontWeight: 500,
                  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                  margin: '12.45px 0px',
                  color: 'rgb(227, 227, 227)',
                }}
              >
                My Gems
              </h2>
              <button
                className="hover:bg-[rgba(255,255,255,0.08)] transition-colors duration-200"
                onClick={() => setShowSharedGemsInfo(!showSharedGemsInfo)}
                title="Notice about shared Gems"
                style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '9999px',
                  color: 'rgb(196, 199, 197)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '8px'
                }}
              >
                <MaterialSymbol name="info" size={20} family="google-symbols" variationSettings="normal" style={{ fontWeight: 400 }} />
              </button>

              {/* Shared Gems Info Popup */}
              <div 
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: '0px', 
                  zIndex: 50,
                  backgroundColor: 'rgb(31, 55, 96)',
                  color: 'rgb(227, 227, 227)',
                  fontFamily: '"Google Sans Flex", "Google Sans", Roboto, Arial, sans-serif',
                  fontSize: '14px',
                  fontWeight: 400,
                  padding: '16px',
                  borderRadius: '8px',
                  width: '280px',
                  boxShadow: 'rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px',
                  opacity: showSharedGemsInfo ? 1 : 0,
                  visibility: showSharedGemsInfo ? 'visible' : 'hidden',
                  transform: showSharedGemsInfo ? 'translateY(0)' : 'translateY(-10px)',
                  transition: 'opacity 150ms cubic-bezier(0.4, 0, 0.2, 1), transform 150ms cubic-bezier(0.4, 0, 0.2, 1), visibility 150ms'
                }}
              >
                <div
                  style={{
                    fontSize: '15px',
                    fontWeight: 400,
                    fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                    color: 'rgb(227, 227, 227)'
                  }}
                >
                  Your shared Gems are saved in the Gemini Gems folder in Google Drive. They are protected by Drive permissions.
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px' }}>
                  <button
                    className="hover:bg-[rgba(168,199,250,0.08)] transition-colors duration-200"
                    onClick={() => setShowSharedGemsInfo(false)}
                    style={{
                      backgroundColor: 'rgba(0, 0, 0, 0)',
                      color: 'rgb(168, 199, 250)',
                      fontFamily: '"Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif',
                      fontSize: '14px',
                      fontWeight: 500,
                      padding: '0px 12px',
                      borderRadius: '9999px',
                      height: '36px',
                      border: 'none',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    Got it
                  </button>
                </div>
              </div>
            </div>
            
            <button
              style={{
                color: 'rgb(6, 46, 111)',
                backgroundColor: 'rgb(168, 199, 250)',
                fontSize: '14px',
                fontWeight: 500,
                fontFamily: '"Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif',
                padding: '0px 20px 0px 24px',
                borderRadius: '30px',
                display: 'inline-flex',
                flexDirection: 'row',
                alignItems: 'center',
                border: 'none',
                height: '40px',
                cursor: 'pointer'
              }}
            >
              <MaterialSymbol name="add" size={18} family="google-symbols" variationSettings="normal" style={{ fontWeight: 400, marginRight: '8px', marginLeft: '-8px' }} />
              <span
                style={{
                  fontSize: '13px',
                  fontWeight: 400,
                  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif'
                }}
              >
                New Gem
              </span>
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {/* Custom Gem List Row */}
            <div
              style={{
                width: '830px',
                height: '72px',
                backgroundColor: 'rgb(30, 31, 32)',
                borderRadius: '12px',
                padding: '0px 8px 0px 0px',
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                boxSizing: 'border-box',
                cursor: 'pointer'
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'row',
                  gap: '12px',
                  padding: '16px 0px 16px 16px',
                  alignItems: 'center',
                  flex: 1
                }}
              >
                <div
                  style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '50%',
                    backgroundColor: 'rgb(0, 64, 78)',
                    color: 'rgb(37, 178, 212)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '16px',
                    fontWeight: 500,
                    fontFamily: '"Google Sans", "Helvetica Neue", sans-serif'
                  }}
                >
                  V
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div
                    style={{
                      fontSize: '16px',
                      fontWeight: 500,
                      fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                      color: 'rgb(227, 227, 227)'
                    }}
                  >
                    Video Prompter v2
                  </div>
                </div>
              </div>
              
              <div style={{ padding: '8px', display: 'flex', flexDirection: 'row' }}>
                <ActionButton icon="share" title="Share" />
                <ActionButton icon="edit" title="Edit Gem" />
                <OverflowMenuButton items={MY_GEM_MENU_ITEMS} />
              </div>
            </div>
          </div>
        </section>

        {/* End of content */}
      </div>
    </div>
    </>
  );
};

export default GemsView;
