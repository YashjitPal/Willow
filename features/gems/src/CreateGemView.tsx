import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useNavigate } from 'react-router-dom';

export const CreateGemView: React.FC = () => {
  const navigate = useNavigate();
  const [nameFocused, setNameFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const [instFocused, setInstFocused] = useState(false);
  
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [instructions, setInstructions] = useState('');
  const [nameTouched, setNameTouched] = useState(false);

  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isNameError = nameTouched && name.trim().length === 0;
  const canSave = name.trim().length > 0;

  const [selectedTool, setSelectedTool] = useState('No default tool');
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [menuCoords, setMenuCoords] = useState<{top: number, left: number} | null>(null);
  const toolButtonRef = useRef<HTMLButtonElement>(null);

  const TOOL_MENU_ITEMS = [
    { text: 'No default tool', icon: 'do_not_disturb_on', family: 'google-symbols' },
    { text: 'Create image', icon: 'image_create', family: 'luminous' },
    { text: 'Create video', icon: 'movie', family: 'luminous' },
    { text: 'Create music', icon: 'music', family: 'luminous' },
    { text: 'Canvas', icon: 'canvas', family: 'luminous' },
    { text: 'Deep research', icon: 'deep_research', family: 'luminous' },
    { text: 'Guided learning', icon: 'guided_learning', family: 'luminous' }
  ];

  useEffect(() => {
    const handleResize = () => setToolMenuOpen(false);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      overflowX: 'auto',
      overflowY: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '24px 24px 16px 70px',
      boxSizing: 'border-box',
      background: '#131314'
    }}>
      <style>{`
        @keyframes menu-enter {
          0% { opacity: 0; transform: scale(0.8); }
          100% { opacity: 1; transform: scale(1); }
        }
        @keyframes menu-exit {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: 0; transform: scale(0.8); }
        }
        .default-tool-btn {
          background-color: transparent;
        }
        .default-tool-btn:hover, .default-tool-btn:focus, .default-tool-btn[data-open="true"] {
          background-color: rgba(227, 227, 227, 0.08) !important;
        }
        @font-face {
          font-family: "Google Symbols";
          font-style: normal;
          font-weight: 100 700;
          font-display: block;
          src: url("//fonts.gstatic.com/l/font?kit=Hhy3U5Ak9u-oMExPeInvcuEmPosC9zS3FYkFU68cPrjdKM1XMoDZlWmzc_IiQP9Pl2qlTD28M00Ic5PBvgjUKh-hL5SsUfna8181gW5cw07ABjrw0mO4bD6GPxon5_oEbD-5h7ZDXXSzrmdLquZIuQBxUvaZArLpc9_WPl-rKXilymEUxDQvP0_oYFlasoxiIzXiRU4pPzsii1P730THJCtscKKmgltNUNlkgsmao8Q6wHI_VgfRzzLWzxNYqELfM8E-dMZ0M0d4q0oQuuSMb28dFFslsFJoH81T2D8mnRa67xyD1KhjWwdR3qi5cOyp_UzXTexvaYs-ZcCWPfM3V8TAARJ1b2q_fEXeWDuZFXSfLVbuzqt9pXIq6TbdZTb2D8WDvlwuphph_8i_NW8Ed4Ka6GbIPHadNCkixU6VKIKA6B8EP7CSG8fsj1f9y-sxP-1sTQJf5dA7OrczZdGJ8UUAmo4C1xz3w7UGJa4caO42wQJFy2JoYziq_BlXlEfVrWokX2JWEuRxG5fGBMH1owY4cjoCLCzSMDGm1kePLYmKQMV6lJG9-hXnpyoM9-6_V0vQoXyyQb20zCSH_3164EVqhoAiypWWgM6O8AdVypMIwutQLrqHjPpjLsUS7fQQ3g9Xxq2TiPG4JZW7&skey=f8ec4d50247dc1c1&v=v449") format("woff2");
        }
        ::placeholder {
          color: rgb(196, 199, 197);
          opacity: 1;
        }
        ::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        gap: '24px',
        padding: '24px',
        background: 'rgb(27, 27, 27)',
        borderRadius: '24px',
        width: '100%',
        maxWidth: '1246px',
        position: 'relative',
        margin: '0',
        flex: 1,
        minHeight: 0
      }}>
        {/* Left Column */}
        <div style={{ flex: '1 1 0%', position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
          {/* Title Container */}
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            margin: '0px 0px 24px',
            height: '50px',
            width: '100%',
            position: 'relative'
          }}>
            <button
              onClick={() => navigate('/gems')}
              style={{
                position: 'absolute',
                left: '-84px',
                top: '1px',
                width: '40px',
                height: '40px',
                padding: '8px',
                borderRadius: '9999px',
                backgroundColor: 'transparent',
                color: 'rgb(196, 199, 197)',
                cursor: 'pointer',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <MaterialSymbol name="arrow_back_ios_new" size={24} />
            </button>
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '50%',
              backgroundColor: 'rgb(25, 29, 28)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}>
              <span className="material-symbols-outlined" style={{ 
                fontFamily: '"Google Symbols"', 
                fontSize: '28.125px', 
                color: 'rgb(169, 172, 170)',
                lineHeight: '28.125px',
                userSelect: 'none'
              }}>
                gem_spark
              </span>
            </div>
            <h2 style={{
              fontSize: '16px',
              fontWeight: 470,
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
              color: 'rgb(227, 227, 227)',
              lineHeight: '24px',
              margin: 0,
              width: '100%',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}>New Gem</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, width: '100%' }}>
            <label style={{ display: 'block', margin: '8px 0px', fontSize: '13px', fontWeight: 400, fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgb(227, 227, 227)', flexShrink: 0 }}>
              Name
            </label>
            <div style={{
              width: '100%',
              minHeight: '56px',
              padding: '16px',
              backgroundColor: 'rgb(19, 19, 20)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              border: `1.6px solid ${isNameError ? 'rgb(242, 184, 181)' : nameFocused ? 'rgb(168, 199, 250)' : 'rgba(0, 0, 0, 0)'}`,
              boxSizing: 'border-box',
              flexShrink: 0
            }}>
              <div style={{ width: '100%', boxSizing: 'border-box', display: 'flex' }}>
                <input
                  type="text"
                  placeholder="Give your Gem a name"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setHasUnsavedChanges(true);
                  }}
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => {
                    setNameFocused(false);
                    setNameTouched(true);
                  }}
                  style={{
                    padding: '0px',
                    margin: '0px',
                    backgroundColor: 'rgb(19, 19, 20)',
                    fontSize: '16px',
                    color: 'rgb(230, 230, 230)',
                    fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                    border: 'none',
                    outline: 'none',
                    width: '100%'
                  }}
                />
              </div>
              {isNameError && (
                <MaterialSymbol name="error" family="google-symbols" size={24} style={{ color: 'rgb(242, 184, 181)', marginLeft: '8px' }} />
              )}
            </div>
            <div style={{ height: '20px', fontSize: '12px', flexShrink: 0, display: 'flex', alignItems: 'center', padding: '0px 16px' }}>
              {isNameError && (
                <span style={{ color: 'rgb(242, 184, 181)', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif' }}>
                  Your Gem requires a name to start testing.
                </span>
              )}
            </div>

            <label style={{ display: 'block', margin: '8px 0px', fontSize: '13px', fontWeight: 400, fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgb(227, 227, 227)', flexShrink: 0 }}>
              Description
            </label>
            <div style={{
              width: '100%',
              minHeight: '56px',
              padding: '16px',
              backgroundColor: 'rgb(19, 19, 20)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'stretch',
              border: `1.6px solid ${descFocused ? 'rgb(168, 199, 250)' : 'rgba(0, 0, 0, 0)'}`,
              boxSizing: 'border-box',
              flexShrink: 0
            }}>
              <textarea
                placeholder="Describe your Gem and explain what it does"
                value={desc}
                onChange={(e) => {
                  setDesc(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                onFocus={() => setDescFocused(true)}
                onBlur={() => setDescFocused(false)}
                style={{
                  fontSize: '16px',
                  color: 'rgb(230, 230, 230)',
                  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                  resize: 'vertical',
                  padding: '0px',
                  border: 'none',
                  outline: 'none',
                  backgroundColor: 'transparent',
                  width: '100%',
                  height: '24px',
                  boxSizing: 'border-box'
                }}
              />
            </div>
            <div style={{ height: '20px', fontSize: '12px', flexShrink: 0 }}></div>

            <div style={{ display: 'flex', alignItems: 'center', height: '40px', margin: '0px', width: '100%', flexShrink: 0 }}>
              <label style={{ display: 'block', margin: '8px 0px', fontSize: '13px', fontWeight: 400, fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgb(227, 227, 227)', width: 'auto' }}>
                Instructions
              </label>
              <button style={{
                width: '40px',
                height: '40px',
                padding: '8px',
                borderRadius: '9999px',
                backgroundColor: 'transparent',
                color: 'rgb(196, 199, 197)',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: '8px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <MaterialSymbol name="info" family="google-symbols" size={20} weight={400} />
              </button>
            </div>
            
            <div style={{
              width: '100%',
              flex: '2 0 auto',
              minHeight: instFocused ? '300px' : '120px',
              transition: 'min-height 0.25s cubic-bezier(0.2, 0, 0, 1)',
              backgroundColor: 'rgb(19, 19, 20)',
              borderRadius: '8px',
              border: `1.6px solid ${instFocused ? 'rgb(168, 199, 250)' : 'rgba(0, 0, 0, 0)'}`,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }}>
              <textarea
                placeholder="Example: You are a horticulturist with a background in natural lawns and native plants, and you help people plan low water gardens. Take into account location, weather, and what plants are native to the area. You are knowledgeable, casual, and friendly."
                value={instructions}
                onChange={(e) => {
                  setInstructions(e.target.value);
                  setHasUnsavedChanges(true);
                }}
                onFocus={() => setInstFocused(true)}
                onBlur={() => setInstFocused(false)}
                style={{
                  fontSize: '17px',
                  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                  color: 'rgb(227, 227, 227)',
                  padding: '16px 16px 0px',
                  border: 'none',
                  outline: 'none',
                  backgroundColor: 'transparent',
                  flex: 1,
                  resize: 'none',
                  overflow: 'hidden',
                  lineHeight: '24px',
                  WebkitMaskImage: !instFocused ? 'linear-gradient(to bottom, black 40%, transparent 100%)' : 'none',
                  maskImage: !instFocused ? 'linear-gradient(to bottom, black 40%, transparent 100%)' : 'none',
                  transition: 'mask-image 0.25s, -webkit-mask-image 0.25s',
                  boxSizing: 'border-box'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'normal', margin: '0px', padding: '8px' }}>
                <button style={{
                  width: '40px', height: '40px', padding: '8px 6px 8px 8px', backgroundColor: 'rgb(48, 48, 48)',
                  borderRadius: '9999px 0px 0px 9999px', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <span className="material-symbols-outlined" style={{ fontFamily: '"Google Symbols"', fontSize: '24px', color: 'rgba(227, 227, 227, 0.38)', userSelect: 'none' }}>undo</span>
                </button>
                <button style={{
                  width: '40px', height: '40px', padding: '8px 8px 8px 6px', backgroundColor: 'rgb(48, 48, 48)',
                  borderRadius: '0px 9999px 9999px 0px', border: 'none', margin: '0',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <span className="material-symbols-outlined" style={{ fontFamily: '"Google Symbols"', fontSize: '24px', color: 'rgba(227, 227, 227, 0.38)', userSelect: 'none' }}>redo</span>
                </button>
                <button style={{
                  width: '40px', height: '40px', padding: '0px 12px', backgroundColor: 'rgb(48, 48, 48)',
                  borderRadius: '30px', margin: '0px 0px 0px 8px', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <div style={{ width: '14px', height: '22px', display: 'flex', alignItems: 'center', justifyContent: 'normal' }}>
                    <div style={{ width: '22px', height: '22px', margin: '0px -4px', position: 'static', overflow: 'visible', display: 'block' }}>
                      <div style={{ width: '32px', height: '32px', position: 'relative', left: '-5px', top: '-5px', display: 'block' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" preserveAspectRatio="xMidYMid meet" style={{width: '100%', height: '100%', transform: 'translate3d(0px, 0px, 0px)'}}>
                          <defs><clipPath id="__lottie_element_2"><rect width="600" height="600" x="0" y="0"></rect></clipPath></defs>
                          <g clipPath="url(#__lottie_element_2)">
                            <g transform="matrix(1,0,0,1,-27.972991943359375,-92.33197021484375)" opacity="1" style={{display: 'block'}}>
                              <g opacity="1" transform="matrix(1,0,0,1,306.3699951171875,395.8080139160156)">
                                <path fill="rgba(227, 227, 227, 0.38)" fillOpacity="1" d=" M-66.6729965209961,124.92500305175781 C-66.6729965209961,124.92500305175781 -43.801998138427734,124.92500305175781 -43.801998138427734,124.92500305175781 C-43.801998138427734,124.92500305175781 113.08899688720703,-31.96500015258789 113.08899688720703,-31.96500015258789 C113.08899688720703,-31.96500015258789 90.21700286865234,-54.83700180053711 90.21700286865234,-54.83700180053711 C90.21700286865234,-54.83700180053711 -66.6729965209961,102.05400085449219 -66.6729965209961,102.05400085449219 C-66.6729965209961,102.05400085449219 -66.6729965209961,124.92500305175781 -66.6729965209961,124.92500305175781z M-98.77400207519531,157.0260009765625 C-98.77400207519531,157.0260009765625 -98.77400207519531,88.81199645996094 -98.77400207519531,88.81199645996094 C-98.77400207519531,88.81199645996094 113.08899688720703,-122.64900207519531 113.08899688720703,-122.64900207519531 C116.29900360107422,-125.58599853515625 119.84300231933594,-127.87000274658203 123.71399688720703,-129.47000122070312 C127.5979995727539,-131.0749969482422 131.67599487304688,-131.8780059814453 135.96099853515625,-131.8780059814453 C140.24600219726562,-131.8780059814453 144.38800048828125,-131.07400512695312 148.39999389648438,-129.47000122070312 C152.41200256347656,-127.86599731445312 155.89500427246094,-125.45800018310547 158.83200073242188,-122.24800109863281 C158.83200073242188,-122.24800109863281 180.9010009765625,-99.77799987792969 180.9010009765625,-99.77799987792969 C184.11199951171875,-96.84100341796875 186.43800354003906,-93.35800170898438 187.9149932861328,-89.34500122070312 C189.39199829101562,-85.33200073242188 190.1300048828125,-81.31999969482422 190.1300048828125,-77.30699920654297 C190.1300048828125,-73.02200317382812 189.38299560546875,-68.947998046875 187.9149932861328,-65.06099700927734 C186.45399475097656,-61.19300079345703 184.11199951171875,-57.645999908447266 180.9010009765625,-54.435001373291016 C180.9010009765625,-54.435001373291016 -30.559999465942383,157.0260009765625 -30.559999465942383,157.0260009765625 C-30.559999465942383,157.0260009765625 -98.77400207519531,157.0260009765625 -98.77400207519531,157.0260009765625z"></path>
                              </g>
                            </g>
                            <g transform="matrix(1,0,0,1,-27.972991943359375,-92.33197021484375)" opacity="1" style={{display: 'block'}}>
                              <g opacity="1" transform="matrix(1,0,0,1,0,0)">
                                <path fill="rgba(227, 227, 227, 0.38)" fillOpacity="1" d=" M247.7220001220703,408.3819885253906 C247.7220001220703,383.7770080566406 239.16700744628906,362.9110107421875 222.04100036621094,345.7860107421875 C204.9149932861328,328.6610107421875 184.05099487304688,320.1059875488281 159.4459991455078,320.1059875488281 C184.05099487304688,320.1059875488281 204.91600036621094,311.552001953125 222.04100036621094,294.4259948730469 C239.16600036621094,277.29998779296875 247.7220001220703,256.43499755859375 247.7220001220703,231.8300018310547 C247.7220001220703,256.43499755859375 256.2760009765625,277.3009948730469 273.4020080566406,294.4259948730469 C290.52801513671875,311.5509948730469 311.39300537109375,320.1059875488281 335.99798583984375,320.1059875488281 C311.39300537109375,320.1059875488281 290.5270080566406,328.6600036621094 273.4020080566406,345.7860107421875 C256.2770080566406,362.9119873046875 247.7220001220703,383.7770080566406 247.7220001220703,408.3819885253906z"></path>
                              </g>
                            </g>
                          </g>
                        </svg>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '24px 0px 8px', width: '100%', height: '40px', flexShrink: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: 400, color: 'rgb(227, 227, 227)', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif' }}>
                Default tool
              </div>
              <button style={{
                width: '40px', height: '40px', padding: '8px', borderRadius: '9999px', backgroundColor: 'transparent',
                color: 'rgb(196, 199, 197)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <MaterialSymbol name="info" family="google-symbols" size={20} weight={400} />
              </button>
              <div style={{ flex: 1 }}></div>
              <button 
                ref={toolButtonRef}
                className="default-tool-btn"
                data-open={toolMenuOpen}
                onClick={() => {
                  if (toolMenuOpen) {
                    setToolMenuOpen(false);
                  } else if (toolButtonRef.current) {
                    const rect = toolButtonRef.current.getBoundingClientRect();
                    setMenuCoords({ top: rect.top - 360, left: rect.left });
                    setToolMenuOpen(true);
                  }
                }}
                style={{
                  padding: '12px 12px 12px 16px', borderRadius: '9999px', height: '32px', fontSize: '14px', fontWeight: 500,
                  fontFamily: '"Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif',
                  color: 'rgb(227, 227, 227)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0px 4px 0px 0px', cursor: 'pointer'
                }}
              >
                {selectedTool} <MaterialSymbol name={toolMenuOpen ? "keyboard_arrow_up" : "keyboard_arrow_down"} family="google-symbols" size={18} variationSettings='"ROND" 0, "slnt" 0, "wdth" 92, "wght" 370' style={{ marginLeft: '4px' }} />
              </button>
            </div>

            <div style={{ margin: '20px 0px 0px', display: 'flex', alignItems: 'center', width: '100%', flexShrink: 0 }}>
              <label style={{ display: 'block', margin: '8px 0px', fontSize: '13px', fontWeight: 400, fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgb(227, 227, 227)' }}>
                Knowledge
              </label>
              <button style={{
                width: '40px', height: '40px', padding: '10px', borderRadius: '9999px', backgroundColor: 'transparent',
                color: 'rgb(196, 199, 197)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '8px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <MaterialSymbol name="info" family="google-symbols" size={20} weight={400} />
              </button>
            </div>
            
            <div style={{ backgroundColor: 'rgb(19, 19, 20)', borderRadius: '8px', padding: '8px 0px', display: 'flex', alignItems: 'stretch', width: '100%', height: '58px', boxSizing: 'border-box', flexShrink: 0 }}>
              <div style={{ margin: '0px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontSize: '17px', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgb(196, 199, 197)' }}>
                  Add files for your Gem to reference
                </span>
                <button style={{ background: 'transparent', border: 'none', color: 'rgb(227, 227, 227)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialSymbol name="add" size={24} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0px 0px', height: '40px', padding: '0px', flexShrink: 0 }}>
              <div style={{ display: 'block', margin: '0px', height: '40px' }}>
                <label style={{ display: 'flex', alignItems: 'center', cursor: 'default' }}>
                  <div style={{ position: 'relative', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <div style={{ width: '18px', height: '18px', border: '1.6px solid rgba(227, 227, 227, 0.38)', borderRadius: '2px', backgroundColor: 'transparent', boxSizing: 'border-box' }}></div>
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 400, fontFamily: '"Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif', color: 'rgba(227, 227, 227, 0.38)', margin: '0px', padding: '0px' }}>
                    Disable Knowledge Citations
                  </span>
                </label>
              </div>
              <button style={{
                  width: '40px', height: '40px', padding: '8px', borderRadius: '9999px', backgroundColor: 'transparent',
                  color: 'rgb(196, 199, 197)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <MaterialSymbol name="info" family="google-symbols" size={20} weight={400} />
              </button>
            </div>

          </div>
        </div>

        {/* Right Column */}
        <div style={{ flex: '1 1 0%', position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
          <div style={{ height: '50px', marginBottom: '24px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexShrink: 0, gap: '16px' }}>
            {hasUnsavedChanges && (
              <div style={{
                color: 'rgb(142, 145, 143)',
                fontSize: '15px',
                fontWeight: 400,
                fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                fontStyle: 'italic',
                margin: '0px'
              }}>
                Gem not saved
              </div>
            )}
            <button
              disabled={!canSave}
              style={{
                height: '40px',
                padding: '0px 24px',
                backgroundColor: canSave ? 'rgb(168, 199, 250)' : 'rgba(227, 227, 227, 0.12)',
                borderRadius: '40px',
                color: canSave ? 'rgb(6, 46, 111)' : 'rgba(227, 227, 227, 0.38)',
                fontSize: '14px',
                fontWeight: 500,
                fontFamily: '"Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: canSave ? 'pointer' : 'default'
              }}
            >
              Save
            </button>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflowY: 'auto', minHeight: 0 }}>
            <label style={{ margin: '8px 0px', fontSize: '13px', fontWeight: 400, color: 'rgb(227, 227, 227)', display: 'block', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', flexShrink: 0 }}>
              Preview
            </label>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, borderRadius: '8px', position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              top: 0, bottom: 0, left: 0, right: 0,
              padding: '0px 48px',
              backgroundColor: 'rgba(19, 19, 20, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              fontSize: '17px',
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
              color: 'rgb(227, 227, 227)',
              boxSizing: 'border-box'
            }}>
              <span style={{ fontSize: '17px', display: 'block' }}>To preview your Gem start by giving it a name</span>
            </div>
            <div style={{
              position: 'absolute',
              bottom: '0',
              left: '16px', // Center input in preview area
              width: 'calc(100% - 32px)',
              height: '64px',
              padding: '12px',
              display: 'grid',
              gridTemplateColumns: '40px auto 146.6px',
              alignItems: 'center',
              gap: 'normal 8px',
              backgroundColor: 'rgb(19, 19, 20)',
              color: 'rgba(227, 227, 227, 0.38)',
              borderRadius: '32px',
              marginBottom: '16px',
              boxSizing: 'border-box'
            }}>
              <button style={{
                width: '32px', height: '32px', padding: '4px', borderRadius: '9999px', backgroundColor: 'transparent',
                color: 'rgba(227, 227, 227, 0.38)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <MaterialSymbol name="add" size={24} />
              </button>
              <div style={{ fontSize: '16px', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif' }}>
                Ask Gemini
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' }}>
                <button style={{
                  padding: '0px 16px', borderRadius: '9999px', height: '40px', fontSize: '14px', fontWeight: 500,
                  backgroundColor: 'transparent', opacity: 0.38, color: 'rgba(227, 227, 227, 0.38)', border: 'none', display: 'flex', alignItems: 'center', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif'
                }}>
                  Flash <MaterialSymbol name="arrow_drop_down" size={20} />
                </button>
                <button style={{
                  width: '32px', height: '32px', borderRadius: '50%', backgroundColor: 'transparent', color: 'rgba(227, 227, 227, 0.38)', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <MaterialSymbol name="arrow_upward" size={20} />
                </button>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>
      
      {toolMenuOpen && menuCoords && createPortal(
        <div 
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
          onClick={(e) => { e.stopPropagation(); setToolMenuOpen(false); }}
        >
          <div 
            style={{
              position: 'absolute',
              top: menuCoords.top,
              left: menuCoords.left,
              width: '320px',
              backgroundColor: 'rgb(30, 31, 32)',
              borderRadius: '16px',
              padding: '8px 0px',
              boxShadow: 'rgba(0, 0, 0, 0.2) 0px 3px 1px -2px, rgba(0, 0, 0, 0.14) 0px 2px 2px 0px, rgba(0, 0, 0, 0.12) 0px 1px 5px 0px',
              zIndex: 1000,
              transformOrigin: '0px 352px',
              animation: '0.12s cubic-bezier(0, 0, 0.2, 1) menu-enter',
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {TOOL_MENU_ITEMS.map((item, i) => (
              <button
                key={i}
                onClick={() => { 
                  setSelectedTool(item.text); 
                  setToolMenuOpen(false); 
                  setHasUnsavedChanges(true);
                  toolButtonRef.current?.focus();
                }}
                style={{
                  height: '48px',
                  padding: '0px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  backgroundColor: 'transparent',
                  border: 'none',
                  color: 'rgb(227, 227, 227)',
                  fontSize: '14px',
                  fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(227, 227, 227, 0.12)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
              >
                <MaterialSymbol name={item.icon} family={item.family as any} size={24} style={{ color: 'rgb(196, 199, 197)' }} />
                <span>{item.text}</span>
                {selectedTool === item.text && (
                  <MaterialSymbol name="check_circle" family="google-symbols" size={20} fill={true} variationSettings='"FILL" 1, "wght" 400' style={{ color: 'rgb(78, 143, 248)' }} />
                )}
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}

      <div style={{
        padding: '16px 0px 0px',
        margin: '0px',
        textAlign: 'center',
        color: 'rgb(196, 199, 197)',
        fontSize: '13px',
        fontWeight: 400,
        lineHeight: '17px',
        fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <MaterialSymbol name="error" size={15} style={{ marginRight: '6px' }} />
        <span>
          Gemini can make mistakes, so double-check responses. Your custom Gems will also be visible in Gemini for Workspace (<a target="_blank" rel="noopener" href="https://support.google.com/a/answer/15706919" style={{ color: 'rgb(230, 230, 230)', textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}>learn more</a>). Create Gems <a target="_blank" rel="noopener" href="https://policies.google.com/terms/generative-ai/use-policy" style={{ color: 'rgb(230, 230, 230)', textDecoration: 'underline dotted', textUnderlineOffset: '2px' }}>responsibly</a>.
        </span>
      </div>
    </div>
  );
};
