import React, { useState } from 'react';
import { MaterialSymbol } from '@willow/ui/MaterialSymbol';
import { useNavigate } from 'react-router-dom';

export const CreateGemView: React.FC = () => {
  const navigate = useNavigate();
  const [nameFocused, setNameFocused] = useState(false);
  const [descFocused, setDescFocused] = useState(false);
  const [instFocused, setInstFocused] = useState(false);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      overflowY: 'auto',
      display: 'flex',
      justifyContent: 'center',
      background: '#131314'
    }}>
      <style>{`
        ::placeholder {
          color: rgba(227, 227, 227, 0.5);
        }
      `}</style>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '553px 529px',
        gap: '0px 24px',
        padding: '24px',
        background: 'rgb(27, 27, 27)',
        borderRadius: '24px',
        width: '1154px',
        maxWidth: '1246px',
        position: 'relative',
        margin: '24px auto'
      }}>
        {/* Left Column */}
        <div style={{ width: '553px', position: 'relative' }}>
          {/* Title Container */}
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            margin: '0px 0px 24px',
            height: '50px',
            width: '553px',
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
              justifyContent: 'center'
            }}>
              <MaterialSymbol name="temp_preferences_custom" size={28} style={{ color: 'rgb(169, 172, 170)' }} />
            </div>
            <h2 style={{
              fontSize: '16px',
              fontWeight: 470,
              fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif',
              color: 'rgb(227, 227, 227)',
              lineHeight: '24px',
              margin: 0
            }}>New Gem</h2>
            <div style={{ flex: 1 }} />
            <button
              disabled
              style={{
                height: '40px',
                padding: '0px 24px',
                backgroundColor: 'rgba(227, 227, 227, 0.12)',
                borderRadius: '40px',
                color: 'rgba(227, 227, 227, 0.38)',
                fontSize: '14px',
                fontWeight: 500,
                fontFamily: '"Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif',
                border: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'default'
              }}
            >
              Save
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '553px' }}>
            <label style={{ display: 'block', margin: '8px 0px', fontSize: '13px', fontWeight: 400, fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgb(227, 227, 227)' }}>
              Name
            </label>
            <div style={{
              width: '553px',
              height: '56px',
              padding: '0px 16px',
              backgroundColor: 'rgb(19, 19, 20)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'baseline',
              border: `1.6px solid ${nameFocused ? 'rgb(168, 199, 250)' : 'rgb(142, 145, 143)'}`,
              boxSizing: 'border-box'
            }}>
              <div style={{ padding: '16px 0px', minHeight: '56px', width: '100%', boxSizing: 'border-box' }}>
                <input
                  type="text"
                  placeholder="Give your Gem a name"
                  onFocus={() => setNameFocused(true)}
                  onBlur={() => setNameFocused(false)}
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
            </div>
            <div style={{ height: '20px', fontSize: '12px' }}></div>

            <label style={{ display: 'block', margin: '8px 0px', fontSize: '13px', fontWeight: 400, fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgb(227, 227, 227)' }}>
              Description
            </label>
            <div style={{
              width: '553px',
              height: '56.675px',
              padding: '0px 16px',
              backgroundColor: 'rgb(19, 19, 20)',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              border: `1.6px solid ${descFocused ? 'rgb(168, 199, 250)' : 'rgb(142, 145, 143)'}`,
              boxSizing: 'border-box'
            }}>
              <textarea
                placeholder="Describe your Gem and explain what it does"
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
            <div style={{ height: '20px', fontSize: '12px' }}></div>

            <div style={{ display: 'flex', alignItems: 'center', height: '40px', margin: '0px', width: '553px' }}>
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
                <MaterialSymbol name="info" size={20} />
              </button>
            </div>
            
            <div style={{
              width: '553px',
              backgroundColor: 'rgb(19, 19, 20)',
              borderRadius: '8px',
              border: `1.6px solid ${instFocused ? 'rgb(168, 199, 250)' : 'rgba(0, 0, 0, 0)'}`,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box'
            }}>
              <textarea
                placeholder="Example: You are a horticulturist with a background in natural lawns and native plants, and you help people plan low water gardens. Take..."
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
                  width: '100%',
                  height: '125.925px',
                  resize: 'vertical',
                  boxSizing: 'border-box'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'normal', margin: '0px', padding: '8px' }}>
                <button style={{
                  width: '40px', height: '40px', padding: '8px 6px 8px 8px', backgroundColor: 'rgb(48, 48, 48)',
                  borderRadius: '9999px 0px 0px 9999px', color: 'rgba(227, 227, 227, 0.38)', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <MaterialSymbol name="undo" size={24} />
                </button>
                <button style={{
                  width: '40px', height: '40px', padding: '8px 8px 8px 6px', backgroundColor: 'rgb(48, 48, 48)',
                  borderRadius: '0px 9999px 9999px 0px', color: 'rgba(227, 227, 227, 0.38)', border: 'none', marginLeft: '1px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <MaterialSymbol name="redo" size={24} />
                </button>
                <button style={{
                  width: '40px', height: '40px', padding: '0px 12px', backgroundColor: 'rgb(48, 48, 48)',
                  borderRadius: '30px', margin: '0px 0px 0px 8px', color: 'rgba(227, 227, 227, 0.38)', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center'
                }}>
                  <MaterialSymbol name="magic_button" size={20} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', margin: '24px 0px 8px', width: '553px', height: '40px' }}>
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
                <MaterialSymbol name="info" size={20} />
              </button>
              <div style={{ flex: 1 }}></div>
              <button style={{
                padding: '12px 12px 12px 16px', borderRadius: '9999px', height: '32px', fontSize: '14px', fontWeight: 500,
                color: 'rgb(227, 227, 227)', backgroundColor: 'transparent', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0px 4px 0px 0px', cursor: 'pointer'
              }}>
                No default tool <MaterialSymbol name="arrow_drop_down" size={20} style={{ marginLeft: '4px' }} />
              </button>
            </div>

            <div style={{ margin: '20px 0px 0px', display: 'flex', alignItems: 'center', width: '553px' }}>
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
                <MaterialSymbol name="info" size={20} />
              </button>
            </div>
            
            <div style={{ backgroundColor: 'rgb(19, 19, 20)', borderRadius: '8px', padding: '8px 0px', display: 'flex', alignItems: 'stretch', width: '553px', height: '58px', boxSizing: 'border-box' }}>
              <div style={{ margin: '0px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                <span style={{ fontSize: '17px', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif', color: 'rgba(227, 227, 227, 0.5)' }}>
                  Add files for your Gem to reference
                </span>
                <button style={{ background: 'transparent', border: 'none', color: 'rgb(227, 227, 227)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <MaterialSymbol name="add" size={24} />
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', margin: '16px 0px 0px' }}>
               <input type="checkbox" disabled style={{ marginRight: '8px' }} />
               <span style={{ fontSize: '14px', fontFamily: '"Google Sans Flex", "Google Sans Text", "Google Sans", sans-serif', color: 'rgb(227, 227, 227)' }}>
                 Disable knowledge citations
               </span>
               <button style={{
                  width: '40px', height: '40px', padding: '8px', borderRadius: '9999px', backgroundColor: 'transparent',
                  color: 'rgb(196, 199, 197)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', marginLeft: '8px'
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  <MaterialSymbol name="info" size={20} />
                </button>
            </div>

          </div>
        </div>

        {/* Right Column */}
        <div style={{ width: '529px', position: 'relative' }}>
          <label style={{ margin: '8px 0px', fontSize: '13px', fontWeight: 400, color: 'rgb(227, 227, 227)', display: 'block', fontFamily: '"Google Sans Flex", "Google Sans", "Helvetica Neue", sans-serif' }}>
            Preview
          </label>
          <div style={{ width: '529px', height: '597.6px', borderRadius: '8px', position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute',
              padding: '0px 48px',
              backgroundColor: 'rgba(19, 19, 20, 0.8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '529px',
              height: '597.6px',
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
              width: '497px',
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
  );
};
