/*
 * Willow remote-browser bridge.
 *
 * `_browse-proxy.js` injects this as the first script of every proxied HTML
 * document, passing the page's real origin as the IIFE's argument. It runs in
 * the page, on the page's proxy origin (`<base32 origin>.wb.localhost`), which is
 * cross-origin to Willow on purpose — so Willow cannot reach in, and this script
 * is how Spark's browser agent sees and acts on the page instead:
 *
 *  - it answers `postMessage` requests from the parent frame only: a screenshot of
 *    the viewport (html2canvas, run here, in the page) and the input actions the
 *    agent's model emits (click, type, hover, scroll, key, drag, navigate);
 *  - it reports where the page is (real URL, title, favicon, loading) so Willow's
 *    address bar can show the site rather than the proxy host;
 *  - it keeps navigation inside the proxy: links, forms, `location` changes and
 *    `window.open` to any real origin are rewritten to that origin's proxy host,
 *    and cross-origin fetches are routed through the proxy so CORS cannot fail them.
 *
 * Plain ES2019 in one IIFE, no imports, because it runs inside arbitrary pages.
 */
(function willowBrowseBridge(config) {
  'use strict';
  if (window.__willowBrowseBridge) return;
  try {
    Object.defineProperty(window, '__willowBrowseBridge', { value: true });
  } catch (error) {
    window.__willowBrowseBridge = true;
  }

  var TAG = '__willowBrowse';
  var SUFFIX = config.suffix;
  var REAL_ORIGIN = config.origin;
  var INTERNAL = '/__willow_browse__/';
  var parentWindow = window.parent;
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  var nativePostMessage = parentWindow.postMessage.bind(parentWindow);

  var ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
  var LABEL = 60;

  function encodeOrigin(origin) {
    var bytes = new TextEncoder().encode(origin);
    var out = '';
    var bits = 0;
    var value = 0;
    for (var i = 0; i < bytes.length; i += 1) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        out += ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
    var labels = [];
    for (var at = 0; at < out.length; at += LABEL) labels.push(out.slice(at, at + LABEL));
    return labels.join('.');
  }

  function decodeOrigin(encoded) {
    var text = encoded.replace(/\./g, '').toLowerCase();
    var bytes = [];
    var bits = 0;
    var value = 0;
    for (var i = 0; i < text.length; i += 1) {
      var index = ALPHABET.indexOf(text[i]);
      if (index < 0) return null;
      value = (value << 5) | index;
      bits += 5;
      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }
    return new TextDecoder().decode(new Uint8Array(bytes));
  }

  var hostSuffix = '.' + SUFFIX;

  function isProxyUrl(url) {
    return url.hostname.toLowerCase().slice(-hostSuffix.length) === hostSuffix
      && url.port === location.port;
  }

  function toProxy(input) {
    var url;
    try {
      url = new URL(String(input), document.baseURI);
    } catch (error) {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (isProxyUrl(url) || url.origin === location.origin) return url.href;
    return location.protocol + '//' + encodeOrigin(url.origin) + hostSuffix
      + (location.port ? ':' + location.port : '') + url.pathname + url.search + url.hash;
  }

  function toReal(input) {
    var url;
    try {
      url = new URL(String(input), location.href);
    } catch (error) {
      return String(input);
    }
    if (!isProxyUrl(url)) return url.href;
    var origin = decodeOrigin(url.hostname.slice(0, -hostSuffix.length));
    // The proxy's post/redirect/get token is not part of the page's address.
    var search = url.search.replace(/([?&])__willow_post=[^&#]*&?/, '$1').replace(/[?&]$/, '');
    return origin ? origin + url.pathname + search + url.hash : url.href;
  }

  /* ---------------------------------------------------------------- */
  /* Keep navigation inside the proxy                                  */
  /* ---------------------------------------------------------------- */

  function leavesProxy(url) {
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin !== location.origin
      && !isProxyUrl(url);
  }

  function submitPost(action, formData, enctype) {
    var form = document.createElement('form');
    form.method = 'post';
    form.action = action;
    if (enctype) form.enctype = enctype;
    form.style.display = 'none';
    formData.forEach(function (value, key) {
      if (typeof value !== 'string') return;
      var input = document.createElement('input');
      input.type = 'hidden';
      input.name = key;
      input.value = value;
      form.appendChild(input);
    });
    (document.body || document.documentElement).appendChild(form);
    HTMLFormElement.prototype.submit.call(form);
  }

  if (window.navigation && typeof window.navigation.addEventListener === 'function') {
    window.navigation.addEventListener('navigate', function (event) {
      var destination;
      try {
        destination = new URL(event.destination.url);
      } catch (error) {
        return;
      }
      // Where the frame is headed, in case what loads there has no bridge to say so.
      if (!event.destination.sameDocument) post({ event: 'navigating', url: toReal(destination.href) });
      if (!leavesProxy(destination) || !event.cancelable) return;
      event.preventDefault();
      var proxied = toProxy(destination.href);
      if (!proxied) return;
      if (event.formData) submitPost(proxied, event.formData);
      else if (event.navigationType === 'replace') location.replace(proxied);
      else location.assign(proxied);
    });
  }

  // Popups are sandboxed away, so a `_blank` link would do nothing. Open it here.
  document.addEventListener('click', function (event) {
    var target = event.target;
    var anchor = target && target.closest ? target.closest('a[href]') : null;
    if (!anchor) return;
    if (anchor.target && anchor.target !== '_self') anchor.target = '_self';
    if (window.navigation) return;
    var url;
    try {
      url = new URL(anchor.href, document.baseURI);
    } catch (error) {
      return;
    }
    if (!leavesProxy(url) || event.defaultPrevented) return;
    event.preventDefault();
    location.assign(toProxy(url.href));
  }, true);

  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (form && form.target && form.target !== '_self') form.target = '_self';
  }, true);

  window.open = function (url) {
    if (url) {
      var proxied = toProxy(url);
      if (proxied) location.assign(proxied);
    }
    return window;
  };

  ['pushState', 'replaceState'].forEach(function (name) {
    var native = history[name];
    history[name] = function (state, title, url) {
      if (url !== undefined && url !== null) {
        try {
          var next = new URL(String(url), document.baseURI);
          if (next.origin !== location.origin) url = toProxy(next.href);
        } catch (error) {
          // Leave it for the native call to reject.
        }
      }
      var result = native.call(history, state, title, url);
      queueReport();
      return result;
    };
  });

  /* ---------------------------------------------------------------- */
  /* Route cross-origin requests through the proxy                     */
  /* ---------------------------------------------------------------- */

  function rewriteRequestUrl(input) {
    var url;
    try {
      url = new URL(String(input), document.baseURI);
    } catch (error) {
      return null;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.origin === location.origin) return null;
    if (url.origin === REAL_ORIGIN) return location.origin + url.pathname + url.search;
    if (isProxyUrl(url)) return null;
    return location.origin + INTERNAL + 'raw?url=' + encodeURIComponent(url.href);
  }

  if (nativeFetch) {
    window.fetch = function (input, init) {
      try {
        var raw = typeof Request !== 'undefined' && input instanceof Request ? input.url : String(input);
        var rewritten = rewriteRequestUrl(raw);
        if (rewritten) {
          input = typeof Request !== 'undefined' && input instanceof Request ? new Request(rewritten, input) : rewritten;
        }
      } catch (error) {
        // Fall through to the original request.
      }
      return nativeFetch(input, init);
    };
  }

  if (window.XMLHttpRequest) {
    var nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url) {
      var args = Array.prototype.slice.call(arguments);
      try {
        var rewritten = rewriteRequestUrl(url);
        if (rewritten) args[1] = rewritten;
      } catch (error) {
        // Fall through to the original request.
      }
      return nativeOpen.apply(this, args);
    };
  }

  /* ---------------------------------------------------------------- */
  /* Report where the page is                                          */
  /* ---------------------------------------------------------------- */

  function faviconUrl() {
    var links = document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    for (var i = 0; i < links.length; i += 1) {
      var href = links[i].getAttribute('href');
      if (href) {
        try {
          return toReal(new URL(href, document.baseURI).href);
        } catch (error) {
          // Try the next one.
        }
      }
    }
    return REAL_ORIGIN + '/favicon.ico';
  }

  function post(message) {
    message[TAG] = 1;
    try {
      nativePostMessage(message, '*');
    } catch (error) {
      // The parent went away.
    }
  }

  function state() {
    return {
      url: toReal(location.href),
      title: document.title || '',
      favicon: faviconUrl(),
      loading: document.readyState !== 'complete',
      parsed: document.readyState !== 'loading',
      width: window.innerWidth,
      height: window.innerHeight,
      canGoBack: Boolean(window.navigation && window.navigation.canGoBack),
      canGoForward: Boolean(window.navigation && window.navigation.canGoForward),
    };
  }

  var reportTimer = 0;
  function queueReport() {
    if (reportTimer) return;
    reportTimer = setTimeout(function () {
      reportTimer = 0;
      var current = state();
      current.event = 'state';
      post(current);
    }, 50);
  }

  window.addEventListener('popstate', queueReport);
  window.addEventListener('hashchange', queueReport);
  window.addEventListener('load', queueReport);
  window.addEventListener('pagehide', function () {
    post({ event: 'unload' });
  });
  document.addEventListener('DOMContentLoaded', function () {
    queueReport();
    var title = document.querySelector('title');
    if (title && window.MutationObserver) {
      new MutationObserver(queueReport).observe(title, { childList: true, characterData: true, subtree: true });
    }
  });

  /* ---------------------------------------------------------------- */
  /* Seeing the page                                                    */
  /* ---------------------------------------------------------------- */

  var html2canvasLoad = null;
  function loadHtml2canvas() {
    if (!html2canvasLoad) {
      html2canvasLoad = nativeFetch(location.origin + INTERNAL + 'html2canvas.js')
        .then(function (response) {
          if (!response.ok) throw new Error('html2canvas is unavailable');
          return response.text();
        })
        .then(function (source) {
          var previous = window.html2canvas;
          // Shadow any AMD or CommonJS loader the page installed, so the UMD bundle
          // registers as a plain global instead of as the page's module.
          new Function('define', 'module', 'exports', source).call(window, undefined, undefined, undefined);
          var loaded = window.html2canvas;
          window.html2canvas = previous;
          if (typeof loaded !== 'function') throw new Error('html2canvas did not load');
          return loaded;
        });
      html2canvasLoad.catch(function () {
        html2canvasLoad = null;
      });
    }
    return html2canvasLoad;
  }

  function pageBackground() {
    var candidates = [document.body, document.documentElement];
    for (var i = 0; i < candidates.length; i += 1) {
      if (!candidates[i]) continue;
      var color = getComputedStyle(candidates[i]).backgroundColor;
      if (color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)') return color;
    }
    return '#ffffff';
  }

  /*
   * A browser applies the root element's overflow to the viewport (the body's, when
   * the root's is visible), so neither element clips itself. html2canvas clips them
   * to their own boxes instead, and a page styled `html { height: 100%; overflow-y:
   * auto }` then captures blank below its first screen. The clone it paints from is
   * given the browser's reading.
   */
  function releaseViewportOverflow(clone) {
    var rootStyle = getComputedStyle(document.documentElement);
    var fromBody = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible';
    clone.documentElement.style.setProperty('overflow', 'visible', 'important');
    if (fromBody && clone.body) clone.body.style.setProperty('overflow', 'visible', 'important');
  }

  /*
   * html2canvas copies the whole document and then reads every element's styles,
   * which on a long article costs seconds per screenshot (Wikipedia: about ten) for
   * content nowhere near the viewport. It also lays that content out afresh, and
   * where the copy sizes it differently from the live page (lazy images, sections
   * Chrome only sizes once seen) everything on screen lands somewhere else.
   *
   * So the copy keeps whole only what paints into the viewport, every ancestor of
   * it, and anything fixed or sticky. Off screen, a subtree below the viewport in
   * block flow is left out, with its parent's height pinned; anything else stays as
   * an empty box at its live size, but only where emptying it cannot move anything
   * — a plain block passes its children's margins through its edges, so those are
   * opened up instead. Sizes come from the live layout, which is what the user sees.
   */
  var CAPTURE_BOX = 'data-willow-capture-box';
  var CAPTURE_PIN = 'data-willow-capture-pin';
  var CAPTURE_SCROLL = 'data-willow-capture-scroll';
  var CAPTURE_ANCHOR = 'data-willow-capture-anchor';
  var BOXED = /^(block|flow-root|list-item|flex|grid|table|inline-block|inline-flex|inline-grid|inline-table)$/;
  var BLOCK_FLOW = /^(block|flow-root|list-item|inline-block)$/;
  var BLOCK_LEVEL = /^(block|flow-root|list-item|flex|grid|table)$/;

  function sealsMargins(element, style, parentStyle) {
    if (/^(flex|grid|inline-flex|inline-grid)$/.test(parentStyle.display)) return true;
    if (!/^(block|list-item)$/.test(style.display)) return true;
    if (style.float !== 'none' || style.position === 'absolute' || style.position === 'fixed') return true;
    if (!/^(visible|clip)$/.test(style.overflowX) || !/^(visible|clip)$/.test(style.overflowY)) return true;
    var topEdge = parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
    var bottomEdge = parseFloat(style.paddingBottom) + parseFloat(style.borderBottomWidth);
    if (topEdge > 0 && bottomEdge > 0) return true;
    for (var child = element.firstElementChild; child; child = child.nextElementSibling) {
      var childStyle = getComputedStyle(child);
      if (BLOCK_LEVEL.test(childStyle.display) && childStyle.float === 'none'
        && childStyle.position !== 'absolute' && childStyle.position !== 'fixed') return false;
    }
    return true;
  }

  /** A small element on screen that scrolls with the page, to check the copy lines up with. */
  function captureAnchor(body, height) {
    var fractions = [0.5, 0.35, 0.65, 0.2, 0.8];
    for (var i = 0; i < fractions.length; i += 1) {
      var candidate = document.elementFromPoint(window.innerWidth / 2, height * fractions[i]);
      if (!candidate || candidate === body || candidate === document.documentElement) continue;
      var rect = candidate.getBoundingClientRect();
      if (rect.height <= 0 || rect.height > height / 2) continue;
      var moving = true;
      for (var node = candidate; node && node !== body; node = node.parentElement) {
        var position = getComputedStyle(node).position;
        if (position === 'fixed' || position === 'sticky') { moving = false; break; }
      }
      if (moving) return { element: candidate, top: rect.top };
    }
    return null;
  }

  function planCapture() {
    var body = document.body;
    if (!body) return null;
    var height = window.innerHeight;
    var slack = Math.round(height * 0.25);
    var top = -slack;
    var bottom = height + slack;
    var keep = new Set([body]);
    var all = body.getElementsByTagName('*');
    for (var i = 0; i < all.length; i += 1) {
      var element = all[i];
      var rect = element.getBoundingClientRect();
      if (!(rect.bottom >= top && rect.top <= bottom && (rect.width || rect.height))) {
        var position = getComputedStyle(element).position;
        if (position !== 'fixed' && position !== 'sticky') continue;
      }
      for (var node = element; node && !keep.has(node); node = node.parentElement) keep.add(node);
    }
    var skip = new Set();
    var boxes = new Map();
    var pins = new Map();
    var scrolled = new Map();
    var queue = [body];
    while (queue.length) {
      var parent = queue.pop();
      if (parent.scrollTop || parent.scrollLeft) scrolled.set(parent, parent.scrollLeft + ',' + parent.scrollTop);
      var parentStyle = null;
      for (var child = parent.firstElementChild; child; child = child.nextElementSibling) {
        if (keep.has(child)) { queue.push(child); continue; }
        parentStyle = parentStyle || getComputedStyle(parent);
        if (child.getBoundingClientRect().top > bottom && BLOCK_FLOW.test(parentStyle.display)) {
          skip.add(child);
          if (!pins.has(parent)) pins.set(parent, parentStyle.height);
          continue;
        }
        if (!child.firstElementChild) continue;
        var style = getComputedStyle(child);
        if (!BOXED.test(style.display)) continue;
        if (sealsMargins(child, style, parentStyle)) boxes.set(child, style.width + ',' + style.height);
        else queue.push(child);
      }
    }
    return { skip: skip, boxes: boxes, pins: pins, scrolled: scrolled, anchor: captureAnchor(body, height) };
  }

  function markCapture(plan, on) {
    if (!plan) return;
    var mark = function (name) {
      return function (value, element) {
        if (on) element.setAttribute(name, value);
        else element.removeAttribute(name);
      };
    };
    plan.boxes.forEach(mark(CAPTURE_BOX));
    plan.pins.forEach(mark(CAPTURE_PIN));
    plan.scrolled.forEach(mark(CAPTURE_SCROLL));
    if (plan.anchor) mark(CAPTURE_ANCHOR)('', plan.anchor.element);
  }

  // html2canvas has no masks and paints a masked icon as a square of its fill;
  // drawing the mask image itself keeps the icon's shape.
  function emulateMasks(clone) {
    var view = clone.defaultView;
    var all = clone.body ? clone.body.getElementsByTagName('*') : [];
    for (var i = 0; i < all.length; i += 1) {
      var style = view.getComputedStyle(all[i]);
      var mask = style.webkitMaskImage || style.maskImage;
      if (!mask || mask.indexOf('url(') === -1) continue;
      var target = all[i].style;
      target.setProperty('background-image', mask, 'important');
      target.setProperty('background-size', style.webkitMaskSize || style.maskSize || 'auto', 'important');
      target.setProperty('background-position', style.webkitMaskPosition || style.maskPosition || '0% 0%', 'important');
      target.setProperty('background-repeat', style.webkitMaskRepeat || style.maskRepeat || 'repeat', 'important');
      target.setProperty('background-color', 'transparent', 'important');
    }
  }

  /*
   * A srcset image reports its natural size in CSS pixels — a 2x file 500px wide
   * says 250 — and html2canvas cuts that many pixels out of the file it draws, so
   * the picture comes out as its top-left quarter, enlarged. The copy is pointed at
   * the file it already chose, with no srcset, at its current box size, so the
   * size it reports is the file's own.
   */
  function settleResponsiveImage(img, view) {
    var picture = img.parentElement && img.parentElement.tagName === 'PICTURE' ? img.parentElement : null;
    if (!img.hasAttribute('srcset') && !picture) return null;
    var chosen = img.currentSrc || img.src;
    var style = view.getComputedStyle(img);
    img.style.setProperty('width', style.width, 'important');
    img.style.setProperty('height', style.height, 'important');
    if (picture) {
      var sources = picture.querySelectorAll('source');
      for (var i = 0; i < sources.length; i += 1) sources[i].parentNode.removeChild(sources[i]);
    }
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    if (!chosen) return null;
    img.src = chosen;
    if (img.complete) return null;
    return new Promise(function (resolve) {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
    });
  }

  function settleResponsiveImages(clone) {
    var waits = [];
    var images = clone.images;
    for (var i = 0; i < images.length; i += 1) {
      var wait = settleResponsiveImage(images[i], clone.defaultView);
      if (wait) waits.push(wait);
    }
    if (!waits.length) return null;
    // Chosen files are already in the cache; a slow one is drawn as it stands.
    return Promise.race([Promise.all(waits), new Promise(function (resolve) { setTimeout(resolve, 1500); })]);
  }

  function each(clone, name, apply) {
    var nodes = clone.querySelectorAll('[' + name + ']');
    for (var i = 0; i < nodes.length; i += 1) {
      apply(nodes[i], nodes[i].getAttribute(name));
      nodes[i].removeAttribute(name);
    }
  }

  function prepareClone(clone, plan) {
    releaseViewportOverflow(clone);
    if (plan) {
      each(clone, CAPTURE_BOX, function (node, size) {
        var parts = size.split(',');
        node.style.setProperty('width', parts[0], 'important');
        node.style.setProperty('height', parts[1], 'important');
      });
      each(clone, CAPTURE_PIN, function (node, height) {
        node.style.setProperty('height', height, 'important');
      });
      // html2canvas scrolled the copy while it was still short, so it may have stopped early.
      clone.defaultView.scrollTo(window.scrollX, window.scrollY);
      each(clone, CAPTURE_SCROLL, function (node, offsets) {
        var parts = offsets.split(',');
        node.scrollLeft = Number(parts[0]);
        node.scrollTop = Number(parts[1]);
      });
    }
    emulateMasks(clone);
    var images = settleResponsiveImages(clone);
    if (plan && plan.anchor) {
      var anchor = clone.querySelector('[' + CAPTURE_ANCHOR + ']');
      if (anchor) {
        anchor.removeAttribute(CAPTURE_ANCHOR);
        var shift = anchor.getBoundingClientRect().top - plan.anchor.top;
        if (Math.abs(shift) > 0.5) clone.defaultView.scrollBy(0, shift);
      }
    }
    return images;
  }

  function screenshot(args) {
    var width = window.innerWidth;
    var height = window.innerHeight;
    var quality = typeof args.quality === 'number' ? args.quality : 0.82;
    return loadHtml2canvas().then(function (html2canvas) {
      var plan = null;
      try {
        plan = planCapture();
      } catch (error) {
        plan = null;
      }
      markCapture(plan, true);
      try {
        // The copy is taken synchronously inside this call, so the markers it reads
        // are on the live page no longer than that.
        return html2canvas(document.documentElement, {
          x: window.scrollX,
          y: window.scrollY,
          width: width,
          height: height,
          windowWidth: width,
          windowHeight: height,
          scale: 1,
          useCORS: false,
          allowTaint: false,
          proxy: location.origin + INTERNAL + 'raw',
          imageTimeout: 4000,
          backgroundColor: pageBackground(),
          logging: false,
          ignoreElements: plan ? function (element) {
            return plan.skip.has(element) || plan.boxes.has(element.parentElement);
          } : undefined,
          onclone: function (clone) { return prepareClone(clone, plan); },
        });
      } finally {
        markCapture(plan, false);
      }
    }).then(function (canvas) {
      var output = canvas;
      if (canvas.width !== width || canvas.height !== height) {
        output = document.createElement('canvas');
        output.width = width;
        output.height = height;
        output.getContext('2d').drawImage(canvas, 0, 0, width, height);
      }
      return {
        dataUrl: output.toDataURL('image/jpeg', quality),
        width: width,
        height: height,
        url: toReal(location.href),
        title: document.title || '',
      };
    });
  }

  /* ---------------------------------------------------------------- */
  /* Acting on the page                                                 */
  /* ---------------------------------------------------------------- */

  function toPoint(args) {
    var x = Number(args.x);
    var y = Number(args.y);
    if (!isFinite(x) || !isFinite(y)) throw new Error('The action needs x and y.');
    if (args.normalized !== false) {
      x = (x / 1000) * window.innerWidth;
      y = (y / 1000) * window.innerHeight;
    }
    return {
      x: Math.max(0, Math.min(window.innerWidth - 1, Math.round(x))),
      y: Math.max(0, Math.min(window.innerHeight - 1, Math.round(y))),
    };
  }

  // Drills through open shadow roots and same-origin frames to the innermost element.
  function deepElementFromPoint(x, y) {
    var root = document;
    var offsetX = 0;
    var offsetY = 0;
    var element = null;
    for (var depth = 0; depth < 8; depth += 1) {
      var found = root.elementFromPoint(x - offsetX, y - offsetY);
      if (!found) break;
      element = found;
      if (found.shadowRoot && found.shadowRoot.elementFromPoint) {
        var inner = found.shadowRoot.elementFromPoint(x - offsetX, y - offsetY);
        if (inner && inner !== found) {
          element = inner;
          root = found.shadowRoot;
          continue;
        }
      }
      if (found.tagName === 'IFRAME' || found.tagName === 'FRAME') {
        try {
          var doc = found.contentDocument;
          if (doc) {
            var rect = found.getBoundingClientRect();
            offsetX += rect.left;
            offsetY += rect.top;
            root = doc;
            continue;
          }
        } catch (error) {
          // A cross-origin frame stops here.
        }
      }
      break;
    }
    return { element: element, x: x - offsetX, y: y - offsetY };
  }

  function mouse(element, type, x, y, extra) {
    var init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: element.ownerDocument.defaultView,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      button: 0,
      buttons: type === 'mousedown' || type === 'pointerdown' || type === 'mousemove' ? 1 : 0,
      detail: type === 'click' || type === 'mousedown' || type === 'mouseup' ? 1 : 0,
    };
    if (extra) Object.keys(extra).forEach(function (key) { init[key] = extra[key]; });
    var isPointer = /^pointer/.test(type) && typeof PointerEvent === 'function';
    var EventType = isPointer ? PointerEvent : MouseEvent;
    if (isPointer) {
      init.pointerId = 1;
      init.pointerType = 'mouse';
      init.isPrimary = true;
    }
    return element.dispatchEvent(new EventType(type, init));
  }

  function focusable(element) {
    for (var node = element; node && node !== document.documentElement; node = node.parentElement) {
      if (typeof node.focus === 'function' && (node.tabIndex >= 0 || node.isContentEditable
        || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/.test(node.tagName))) return node;
    }
    return null;
  }

  function clickAt(args) {
    var point = toPoint(args);
    var hit = deepElementFromPoint(point.x, point.y);
    var element = hit.element;
    if (!element) return { success: false, error: 'Nothing is at that point.', point: point };
    mouse(element, 'pointerover', hit.x, hit.y);
    mouse(element, 'mouseover', hit.x, hit.y);
    mouse(element, 'pointermove', hit.x, hit.y);
    mouse(element, 'mousemove', hit.x, hit.y);
    mouse(element, 'pointerdown', hit.x, hit.y);
    var proceed = mouse(element, 'mousedown', hit.x, hit.y);
    var target = focusable(element);
    if (proceed && target && target !== document.activeElement) target.focus({ preventScroll: true });
    mouse(element, 'pointerup', hit.x, hit.y);
    mouse(element, 'mouseup', hit.x, hit.y);
    mouse(element, 'click', hit.x, hit.y);
    if (element.tagName === 'SELECT' || (target && target.tagName === 'SELECT')) {
      var select = element.tagName === 'SELECT' ? element : target;
      if (typeof select.showPicker === 'function') {
        try { select.showPicker(); } catch (error) { /* Not allowed without activation. */ }
      }
    }
    return { success: true, point: point, element: describe(element) };
  }

  function describe(element) {
    if (!element) return '';
    var label = element.getAttribute && (element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder'));
    var text = label || (element.textContent || '').replace(/\s+/g, ' ').trim();
    return element.tagName.toLowerCase() + (text ? ' "' + text.slice(0, 60) + '"' : '');
  }

  function isEditable(element) {
    if (!element) return false;
    if (element.isContentEditable) return true;
    if (element.tagName === 'TEXTAREA') return !element.readOnly && !element.disabled;
    if (element.tagName !== 'INPUT') return false;
    var type = (element.type || 'text').toLowerCase();
    return !element.readOnly && !element.disabled
      && /^(text|search|email|url|tel|password|number|date|datetime-local|month|week|time)$/.test(type);
  }

  function editableAt(element) {
    for (var node = element; node; node = node.parentElement) {
      if (isEditable(node)) return node;
      if (node.tagName === 'LABEL' && node.control && isEditable(node.control)) return node.control;
    }
    var active = document.activeElement;
    if (isEditable(active)) return active;
    if (element && element.querySelector) {
      var inner = element.querySelector('input, textarea, [contenteditable="true"], [contenteditable=""]');
      if (isEditable(inner)) return inner;
    }
    return null;
  }

  function setNativeValue(element, value) {
    var proto = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) descriptor.set.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function selectContents(element) {
    if (element.isContentEditable) {
      var range = document.createRange();
      range.selectNodeContents(element);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else if (typeof element.select === 'function') {
      element.select();
    }
  }

  function caretToEnd(element) {
    if (element.isContentEditable) {
      var range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } else {
      try {
        var length = element.value.length;
        element.setSelectionRange(length, length);
      } catch (error) {
        // Number and date inputs have no selection.
      }
    }
  }

  var KEY_CODES = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, Space: 32, ' ': 32,
    ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39,
    PageUp: 33, PageDown: 34, Home: 36, End: 35,
  };

  function keyName(raw) {
    var key = String(raw).trim();
    var aliases = {
      return: 'Enter', enter: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab',
      backspace: 'Backspace', delete: 'Delete', del: 'Delete', space: ' ', spacebar: ' ',
      up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
      arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
      pageup: 'PageUp', pagedown: 'PageDown', page_up: 'PageUp', page_down: 'PageDown', home: 'Home', end: 'End',
    };
    return aliases[key.toLowerCase()] || key;
  }

  function keyboard(target, type, key, modifiers) {
    var code = KEY_CODES[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
    return target.dispatchEvent(new KeyboardEvent(type, {
      key: key,
      code: key === ' ' ? 'Space' : key.length === 1 ? 'Key' + key.toUpperCase() : key,
      keyCode: code,
      which: code,
      bubbles: true,
      cancelable: true,
      composed: true,
      ctrlKey: modifiers.ctrl,
      shiftKey: modifiers.shift,
      altKey: modifiers.alt,
      metaKey: modifiers.meta,
    }));
  }

  function scrollViewport(amount) {
    var root = document.scrollingElement || document.documentElement;
    root.scrollBy({ top: amount, behavior: 'instant' });
  }

  function press(keys) {
    var parts = String(keys).split('+').map(function (part) { return part.trim(); }).filter(Boolean);
    var modifiers = { ctrl: false, shift: false, alt: false, meta: false };
    var key = '';
    parts.forEach(function (part) {
      var lower = part.toLowerCase();
      if (lower === 'control' || lower === 'ctrl') modifiers.ctrl = true;
      else if (lower === 'shift') modifiers.shift = true;
      else if (lower === 'alt' || lower === 'option') modifiers.alt = true;
      else if (lower === 'meta' || lower === 'command' || lower === 'cmd' || lower === 'super') modifiers.meta = true;
      else key = keyName(part);
    });
    if (!key) return { success: false, error: 'No key given.' };
    var target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body || document.documentElement;
    var proceed = keyboard(target, 'keydown', key, modifiers);
    if (proceed && key.length === 1 && !modifiers.ctrl && !modifiers.meta && !modifiers.alt) {
      keyboard(target, 'keypress', key, modifiers);
      if (isEditable(target)) document.execCommand('insertText', false, key);
    }
    if (proceed) {
      if (key === 'Enter' && target.form && target.tagName === 'INPUT') {
        try { target.form.requestSubmit(); } catch (error) { target.form.submit(); }
      } else if (key === 'Enter' && target.tagName === 'A' && target.href) {
        mouse(target, 'click', 0, 0);
      } else if (key === 'Tab') {
        var focusables = Array.prototype.filter.call(
          document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'),
          function (node) { return node.tabIndex >= 0 && !node.disabled && node.offsetParent !== null; },
        );
        var index = focusables.indexOf(target);
        var next = focusables[(index + (modifiers.shift ? -1 : 1) + focusables.length) % focusables.length];
        if (next) next.focus();
      } else if (key === 'Backspace' && isEditable(target)) {
        document.execCommand('delete');
      } else if (key === 'Delete' && isEditable(target)) {
        document.execCommand('forwardDelete');
      } else if ((key === 'a' || key === 'A') && (modifiers.ctrl || modifiers.meta)) {
        if (isEditable(target)) selectContents(target);
        else document.execCommand('selectAll');
      } else if (!isEditable(target)) {
        var page = window.innerHeight * 0.85;
        if (key === 'PageDown' || (key === ' ' && !modifiers.shift)) scrollViewport(page);
        else if (key === 'PageUp' || (key === ' ' && modifiers.shift)) scrollViewport(-page);
        else if (key === 'ArrowDown') scrollViewport(60);
        else if (key === 'ArrowUp') scrollViewport(-60);
        else if (key === 'End') scrollViewport(1e7);
        else if (key === 'Home') scrollViewport(-1e7);
      }
    }
    keyboard(target, 'keyup', key, modifiers);
    return { success: true };
  }

  function typeAt(args) {
    var point = null;
    if (args.x !== undefined && args.y !== undefined) {
      var clicked = clickAt(args);
      point = clicked.point;
    }
    var hit = point ? deepElementFromPoint(point.x, point.y).element : document.activeElement;
    var target = editableAt(hit);
    if (!target) return { success: false, error: 'There is no text field at that point.', point: point };
    if (target !== document.activeElement) target.focus({ preventScroll: true });
    var text = String(args.text === undefined ? '' : args.text);
    if (args.clear_before_typing || args.clear) {
      selectContents(target);
      if (!document.execCommand('delete')) {
        if (target.isContentEditable) target.textContent = '';
        else setNativeValue(target, '');
      }
    } else {
      caretToEnd(target);
    }
    if (text && !document.execCommand('insertText', false, text)) {
      if (target.isContentEditable) {
        target.textContent += text;
        target.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        setNativeValue(target, (target.value || '') + text);
      }
    }
    if (args.press_enter || args.pressEnter) press('Enter');
    return { success: true, point: point, element: describe(target) };
  }

  /*
   * The page's last text field, kept when it loses focus. The take-over's keyboard bar is
   * outside the page, so typing in it takes the focus away from the field it types for.
   */
  var lastField = null;
  document.addEventListener('focusin', function (event) {
    if (isEditable(event.target)) lastField = event.target;
  }, true);

  /* Text, or one backspace, for that field: at its own caret, leaving the focus where it is. */
  function sendKeyboard(args) {
    var target = isEditable(document.activeElement) ? document.activeElement : lastField;
    if (!target || !target.isConnected || !isEditable(target)) return { success: false, error: 'There is no text field to type into.' };
    var text = args.backspace ? '' : String(args.text === undefined ? '' : args.text);
    if (target === document.activeElement) {
      if (args.backspace) document.execCommand('delete');
      else if (text && !document.execCommand('insertText', false, text)) {
        if (target.isContentEditable) {
          target.textContent += text;
          target.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          setNativeValue(target, (target.value || '') + text);
        }
      }
      return { success: true, element: describe(target) };
    }
    if (target.isContentEditable) {
      target.textContent = args.backspace ? (target.textContent || '').slice(0, -1) : (target.textContent || '') + text;
      target.dispatchEvent(new Event('input', { bubbles: true }));
      return { success: true, element: describe(target) };
    }
    var value = target.value || '';
    var start = value.length;
    var end = value.length;
    try {
      if (typeof target.selectionStart === 'number') {
        start = target.selectionStart;
        end = target.selectionEnd;
      }
    } catch (error) {
      // Number and date inputs have no selection.
    }
    if (args.backspace && start === end) start = Math.max(0, start - 1);
    setNativeValue(target, value.slice(0, start) + text + value.slice(end));
    try {
      target.setSelectionRange(start + text.length, start + text.length);
    } catch (error) {
      // As above.
    }
    return { success: true, element: describe(target) };
  }

  function scrollableAt(element, vertical) {
    for (var node = element; node && node !== document.documentElement && node !== document.body; node = node.parentElement) {
      var style = getComputedStyle(node);
      var overflow = vertical ? style.overflowY : style.overflowX;
      var room = vertical ? node.scrollHeight - node.clientHeight : node.scrollWidth - node.clientWidth;
      if (room > 1 && /(auto|scroll|overlay)/.test(overflow)) return node;
    }
    return document.scrollingElement || document.documentElement;
  }

  function scrollAt(args) {
    var direction = String(args.direction || 'down').toLowerCase();
    var vertical = direction === 'up' || direction === 'down';
    var sign = direction === 'up' || direction === 'left' ? -1 : 1;
    var magnitude = Number(args.magnitude);
    var amount = isFinite(magnitude) && magnitude > 0
      ? magnitude
      : Math.round((vertical ? window.innerHeight : window.innerWidth) * 0.7);
    var point = args.x !== undefined && args.y !== undefined
      ? toPoint(args)
      : { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
    var element = deepElementFromPoint(point.x, point.y).element;
    var target = scrollableAt(element, vertical);
    var before = vertical ? target.scrollTop : target.scrollLeft;
    target.scrollBy({ top: vertical ? sign * amount : 0, left: vertical ? 0 : sign * amount, behavior: 'instant' });
    var after = vertical ? target.scrollTop : target.scrollLeft;
    if (after === before && target !== (document.scrollingElement || document.documentElement)) {
      scrollViewport(vertical ? sign * amount : 0);
    }
    return { success: true, point: point };
  }

  function hoverAt(args) {
    var point = toPoint(args);
    var hit = deepElementFromPoint(point.x, point.y);
    if (!hit.element) return { success: false, error: 'Nothing is at that point.', point: point };
    mouse(hit.element, 'pointerover', hit.x, hit.y);
    mouse(hit.element, 'pointerenter', hit.x, hit.y, { bubbles: false });
    mouse(hit.element, 'mouseover', hit.x, hit.y);
    mouse(hit.element, 'mouseenter', hit.x, hit.y, { bubbles: false });
    mouse(hit.element, 'pointermove', hit.x, hit.y);
    mouse(hit.element, 'mousemove', hit.x, hit.y);
    return { success: true, point: point, element: describe(hit.element) };
  }

  function dragAndDrop(args) {
    var from = toPoint(args);
    var to = toPoint({ x: args.destination_x, y: args.destination_y, normalized: args.normalized });
    var start = deepElementFromPoint(from.x, from.y).element;
    if (!start) return { success: false, error: 'Nothing is at the start point.', point: from };
    mouse(start, 'pointerdown', from.x, from.y);
    mouse(start, 'mousedown', from.x, from.y);
    var steps = 6;
    for (var i = 1; i <= steps; i += 1) {
      var x = from.x + ((to.x - from.x) * i) / steps;
      var y = from.y + ((to.y - from.y) * i) / steps;
      var over = deepElementFromPoint(x, y).element || start;
      mouse(over, 'pointermove', x, y);
      mouse(over, 'mousemove', x, y);
    }
    var end = deepElementFromPoint(to.x, to.y).element || start;
    mouse(end, 'pointerup', to.x, to.y);
    mouse(end, 'mouseup', to.x, to.y);
    return { success: true, point: to };
  }

  function navigate(args) {
    var proxied = toProxy(String(args.url || '').trim());
    if (!proxied) return { success: false, error: 'Only http and https pages can be opened.' };
    setTimeout(function () { location.assign(proxied); }, 0);
    return { success: true, navigating: true };
  }

  var OPS = {
    ping: function () { return state(); },
    screenshot: screenshot,
    click: clickAt,
    type: typeAt,
    keyboard: sendKeyboard,
    hover: hoverAt,
    scroll: scrollAt,
    key: function (args) { return press(args.keys); },
    drag: dragAndDrop,
    navigate: navigate,
    back: function () {
      setTimeout(function () { history.back(); }, 0);
      return { success: true, navigating: true };
    },
    forward: function () {
      setTimeout(function () { history.forward(); }, 0);
      return { success: true, navigating: true };
    },
    reload: function () {
      setTimeout(function () { location.reload(); }, 0);
      return { success: true, navigating: true };
    },
  };

  // Registered before any page script runs, and stops the event there, so the page
  // never sees the parent's requests.
  window.addEventListener('message', function (event) {
    if (event.source !== parentWindow) return;
    var data = event.data;
    if (!data || data[TAG] !== 1 || !data.id || !data.op) return;
    event.stopImmediatePropagation();
    var op = OPS[data.op];
    var reply = function (ok, result, error) {
      post({ id: data.id, ok: ok, result: result, error: error });
    };
    if (!op) {
      reply(false, undefined, 'Unknown action ' + data.op + '.');
      return;
    }
    var run = function () {
      try {
        Promise.resolve(op(data.args || {})).then(function (result) {
          reply(true, result);
          queueReport();
        }, function (error) {
          reply(false, undefined, String((error && error.message) || error));
        });
      } catch (error) {
        reply(false, undefined, String((error && error.message) || error));
      }
    };
    // The bridge runs from <head>; until the body is parsed there is nothing to act on.
    if (document.readyState === 'loading' && data.op !== 'ping') {
      document.addEventListener('DOMContentLoaded', run, { once: true });
    } else {
      run();
    }
  }, true);

  var ready = state();
  ready.event = 'ready';
  post(ready);

  if (document.currentScript && document.currentScript.parentNode) {
    document.currentScript.parentNode.removeChild(document.currentScript);
  }
})(__WILLOW_BROWSE_CONFIG__);
