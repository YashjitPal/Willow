package com.willow.tunnel

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WillowTunnelModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WillowTunnel")

    AsyncFunction("start") { localPort: Int, remoteHost: String, remotePort: Int ->
      TunnelRegistry.start(localPort, remoteHost, remotePort)
    }

    AsyncFunction("stop") { localPort: Int ->
      TunnelRegistry.stop(localPort)
    }

    AsyncFunction("stopAll") {
      TunnelRegistry.stopAll()
    }

    AsyncFunction("clearCookies") { promise: Promise ->
      WebViewSupport.clearCookies { removed -> promise.resolve(removed) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("clearWebData") { promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve(false)
      } else {
        WebViewSupport.clearAll(context) { removed -> promise.resolve(removed) }
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("installDocumentStartScript") { viewTag: Int, script: String, origins: List<String> ->
      WebViewSupport.installDocumentStartScript(appContext, viewTag, script, origins)
    }.runOnQueue(Queues.MAIN)
  }
}
