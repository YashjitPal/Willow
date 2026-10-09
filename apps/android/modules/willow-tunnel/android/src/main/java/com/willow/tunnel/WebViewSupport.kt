package com.willow.tunnel

import android.content.Context
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.WebStorage
import android.webkit.WebView
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import java.util.WeakHashMap

/** Main thread only, like every WebView call. */
internal object WebViewSupport {
  private val documentStartScripts = WeakHashMap<WebView, ScriptHandler>()

  /**
   * Runs [script] at the start of every document whose origin is in [origins], in the
   * WebView under the view [viewTag], before any of the page's own scripts. Replaces
   * the script installed earlier in that WebView. Returns "installed", "unsupported"
   * (the system WebView is too old) or "no-webview" (none mounted under the tag yet).
   */
  fun installDocumentStartScript(appContext: AppContext, viewTag: Int, script: String, origins: List<String>): String {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
      return "unsupported"
    }
    // Fabric throws for a tag it hasn't mounted yet.
    val view = try {
      appContext.findView<View>(viewTag)
    } catch (e: RuntimeException) {
      null
    }
    val webView = view?.let(::findWebView) ?: return "no-webview"
    documentStartScripts.remove(webView)?.remove()
    documentStartScripts[webView] = WebViewCompat.addDocumentStartJavaScript(webView, script, origins.toSet())
    return "installed"
  }

  fun clearCookies(done: (Boolean) -> Unit) {
    val cookies = CookieManager.getInstance()
    cookies.removeAllCookies { removed ->
      cookies.flush()
      done(removed)
    }
  }

  /**
   * Everything the WebView keeps for its pages: their storage (localStorage, IndexedDB and the
   * rest), the HTTP cache and the cookies. What Willow keeps lives on the PC, so the phone's copy
   * is only ever a cache of it.
   */
  fun clearAll(context: Context, done: (Boolean) -> Unit) {
    WebStorage.getInstance().deleteAllData()
    try {
      WebView(context).apply {
        clearCache(true)
        destroy()
      }
    } catch (ignored: RuntimeException) {
    }
    clearCookies(done)
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) {
      return view
    }
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findWebView(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }
}
