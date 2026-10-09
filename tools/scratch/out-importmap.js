k.length-1]:void 0
if(x===-1)q==="\\"?(b+=q+u,l++):q==="`"?(b+="`",k.pop()):q==="$"&&u==="{"?(b+="${",l++,k[k.length-1]=0):b+=q
else
if(x!==void 0&&x>=0)
if(q==="{")
k[k.length-1]++
b+="{"
continue
if(q==="}")
if(x===0)
k[k.length-1]=-1
b+="}"
continue
k[k.length-1]--
b+="}"
continue}
q==="/"&&u==="/"?(b+="//",l++,g=!0):q==="/"&&u==="*"?(b+="/*",l++,h=!0):q==="`"?(b+="`",k.push(-1)):q==="\\"&&u==="'"?(b+="'",l++,e=c=!0):q==="\\"&&u==='"'?
(b+='"',l++,f=d=!0):q==="'"?(b+="'",c=!0,e=!1):q==='"'?(b+='"',d=!0,f=!1):b+=q}
return b},d$=function(a)
var b=a.split("/"),c,d=(c=b[0])!=null?c:""
c=null
if(a.startsWith("@"))
var e
a=(e=b[1])!=null?e:""
e=a.indexOf("@")
if(e>0)return d=`$
d}/$
a.slice(0,e)}`,e=a.slice(e+1)||null,b.length>2&&(c=b.slice(2).join("/")),
MD:d,version:e,tN:c}
d=`$
d}/$
a}`
b.length>2&&(c=b.slice(2).join("/"))
return
MD:d,version:null,tN:c}
a=d.indexOf("@")
if(a>0)return e=d.slice(0,a),d=d.slice(a+1)||null,b.length>1&&
(c=b.slice(1).join("/")),
MD:e,version:d,tN:c}
b.length>1&&(c=b.slice(1).join("/"))
return
MD:d,version:null,tN:c}},e$=function(a)
var 
MD:b,version:c,tN:d}=d$(a),e,f
a=(f=(e=F1b[b])!=null?e:c)!=null?f:"latest"
e=b==="react"||b==="react-dom"
if(f=G1b[b])switch(f.Ola)
case "jsdelivr-dist":return`https://cdn.jsdelivr.net/npm/$
b}@$
a}/$
f.bya}`
case "jsdelivr-esm":return d?`https://cdn.jsdelivr.net/npm/$
b}@$
a}/$
d}/+esm`:`https://cdn.jsdelivr.net/npm/$
b}@$
a}/+esm`
default:_.sb(f,void 0)
a=d?`https://esm.sh/$
b}@$
a}/$
d}`:
`https://esm.sh/$
b}@$
a}`
e||(a+="?external=react,react-dom")
return a},H1b=function(a)
a=(new TextEncoder).encode(a)
var b=""
for(let c=0
c<a.byteLength
c++)b+=String.fromCharCode(a[c])
return`data:text/javascript
base64,$
btoa(b)}`},L1b=function(a,b)
var c={}
c.react=e$("react")
c["react/"]=`https://esm.sh/react@$
F1b.react}/`
c["react-dom"]=e$("react-dom")
c["react-dom/"]=`https://esm.sh/react-dom@$
F1b["react-dom"]}/`
c["react-dom/client"]=e$("react-dom/client")
c["react/jsx-runtime"]=e$("react/jsx-runtime");
c["flow-sdk"]=H1b(I1b)
c["@app"]=H1b(a)
if(b!=null)a=b
else
b=/\bfrom\s+['"]([^'"./][^'"]*)['"]|import\s*\(\s*['"]([^'"./][^'"]*)['"]|\bimport\s+['"]([^'"./][^'"]*)['"]/g
let g=new Set
for(var d;(d=b.exec(a))!==null;)
var e=void 0,f=void 0
let h=(f=(e=d[1])!=null?e:d[2])!=null?f:d[3]
if(!h)continue
d=h.replace(J1b,"")
let 
MD:k,version:l}=d$(d),q=l?`$
k}@$
l}`:k
g.add(q)
d!==q&&g.add(d)
h!==d&&g.add(h)
a=Array.from(g)
for(let g of a)
f=g.replace(J1b,"");(
MD:a}=d$(f))
if(K1b.has(a))continue
if(c[f])continue;
e=e$(f)
c[f]=e
g!==f&&(c[g]=e)
f===a||c[a]||(
tN:f}=d$(f),f||(c[a]=e))
return c},P1b=function(
Iwa:a,gxa:b=[],Gfa:c=!0,HGa:d,Vya:e})
b=b.map(f=>`<style>/* $
f.name.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/\*\//g,"* /")} */\n$
f.content.replace(/<\/style>/gi,"<\\/style>")}\x3c/style>`).join("\n")
a=L1b(a,e)
a=JSON.stringify(
imports:a},null,2).replace(/<\//g,"<\\/")
d=`<script>window.FLOW_PARENT_ORIGIN = $
JSON.stringify(d)};\x3c/script>`;
return`<!DOCTYPE html>
<html lang="en" class="$
c?"dark":""}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  \x3c!-- 
    CSP justification: 'unsafe-eval' and 'wasm-unsafe-eval' are required for
    dynamic applet execution which compiles and runs user-provided code
    and libraries (like OpenCV or custom scripts) in the browser.
  --\x3e
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    script-src https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://docs.opencv.org 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: data:;
    connect-src https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://docs.opencv.org https://huggingface.co https://cdn-lfs.huggingface.co https://*.hf.co https://fonts.googleapis.com https://fonts.gstatic.com https://storage.googleapis.com https://img.youtube.com blob: data:;
    style-src 'unsafe-inline' https://esm.sh https://unpkg.com https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://fonts.googleapis.com;
    font-src https://fonts.gstatic.com https://esm.sh https://cdn.jsdelivr.net;
    img-src * data: blob:;
    media-src * data: blob:;
  ">
  <title>Flow app</title>
  $
d}
  <script>
    ($
M1b.toString()})(window.FLOW_PARENT_ORIGIN);
  \x3c/script>


  \x3c!-- Tailwind CSS v4 (browser build) --\x3e
  <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4">\x3c/script>
  <style type="text/tailwindcss">
    @custom-variant dark (&:where(.dark, .dark *));
    @theme {
      --color-slate-850: #1a1f2e;
      --color-slate-950: #0d1117;
      --color-app-bg-dark: #1a1a1a;
    }
  \x3c/style>

  \x3c!-- Google Fonts --\x3e
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/c

/* ---- */

  '\"');\n            });\n        },\n    },\n};\nexport const Flow = FLOW;\n".replace(/MSG_MINI_APP_OUTPUT/g,
JSON.stringify("Mini-app output")),J1b=/^https?:\/\/(?:esm\.sh|cdn\.jsdelivr\.net\/npm|unpkg\.com)\//,F1b=
react:"19.1.1","react-dom":"19.1.1"},K1b=new Set(["flow-sdk"]),G1b=
p5:
Ola:"jsdelivr-esm",reason:"CJS interop: gifenc named exports broken on esm.sh"},"pixi.js":
Ola:"jsdelivr-dist",bya:"dist/pixi.min.mjs",reason:"Module splitting causes batcher double-registration"}}
var i4b,j4b=[_.PJ(
type:_.QJ("compiler_ready")}).kt(I3b()),_.PJ(
type:_.QJ("compile_result"),requestId:_.IJ(),success:_.LJ(),code:_.IJ().optional(),errors:_.DJ(_.IJ()).optional(),externalImports:_.DJ(_.IJ()).optional()}).kt(I3b())],k4b=new Map
for(let a of j4b)
let b=n$(a.shape.type)
if(!b.length)throw Error("xj`type")
for(let c of b)
if(k4b.has(c))throw Error("yj`type`"+String(c))
k4b.set(c,a)}
i4b=new G3b(Object.assign({},
fh:"ZodDiscriminatedUnion",KZ:"type",options:j4b,IT:k4b},_.gJ()));
var A$=function(a)
a.ha!==void 0&&(clearTimeout(a.ha),a.ha=void 0)
var b;(b=a.ka)==null||b.close()
a.ka=null
a.wa=null
a.container&&(a.container.remove(),a.container=null)
a.ma.set(!1)
a.Aa=null
a.oa=null
a.na=null},m4b=function(a,b=3E4)
return _.z(function*()
a.ma()||(a.na||(a.na=l4b(a,b)),yield a.na)})},l4b=function(a,b)
return _.z(function*()
A$(a)
var c=new Promise((g,h)=>
a.oa=h
a.ha=setTimeout(()=>
h(Error("Aj"))},b)}),d=new Promise(g=>
a.Aa=g}),e=!1,f=()=>_.z(function*()
a.container=document.createElement("div");
a.container.style.display="none"
document.body.appendChild(a.container)
var g=new q$("flow-applet-compiler",
Cya:!0}),h=`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <