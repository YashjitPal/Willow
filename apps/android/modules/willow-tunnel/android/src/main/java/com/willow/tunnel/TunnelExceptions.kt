package com.willow.tunnel

import expo.modules.kotlin.exception.CodedException

internal class InvalidPortException(name: String, port: Int) :
  CodedException("ERR_TUNNEL_PORT", "$name must be between 1 and 65535 (got $port)", null)

internal class InvalidHostException :
  CodedException("ERR_TUNNEL_HOST", "remoteHost must not be empty", null)

internal class TunnelBindException(port: Int, cause: Throwable) :
  CodedException("ERR_TUNNEL_BIND", "Could not listen on 127.0.0.1:$port: ${cause.message}", cause)
