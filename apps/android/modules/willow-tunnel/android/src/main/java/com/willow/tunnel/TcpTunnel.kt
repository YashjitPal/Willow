package com.willow.tunnel

import android.util.Log
import java.io.Closeable
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private const val TAG = "WillowTunnel"
private const val BACKLOG = 64
private const val CONNECT_TIMEOUT_MS = 10_000
private const val BUFFER_SIZE = 32 * 1024

internal data class Remote(val host: String, val port: Int)

/**
 * Raw TCP forwarders, one per local port, for the whole process: they outlive a
 * reload of the JS bundle, and `start` with the same remote leaves one untouched.
 */
internal object TunnelRegistry {
  private val tunnels = HashMap<Int, Tunnel>()

  @Synchronized
  fun start(localPort: Int, remoteHost: String, remotePort: Int) {
    requirePort("localPort", localPort)
    requirePort("remotePort", remotePort)
    val host = remoteHost.trim().removePrefix("[").removeSuffix("]")
    if (host.isEmpty()) {
      throw InvalidHostException()
    }
    val remote = Remote(host, remotePort)
    val existing = tunnels[localPort]
    if (existing != null && existing.isListening) {
      existing.retarget(remote)
      return
    }
    existing?.close()
    tunnels[localPort] = Tunnel.open(localPort, remote)
  }

  @Synchronized
  fun stop(localPort: Int) {
    tunnels.remove(localPort)?.close()
  }

  @Synchronized
  fun stopAll() {
    tunnels.values.forEach { it.close() }
    tunnels.clear()
  }

  private fun requirePort(name: String, port: Int) {
    if (port !in 1..65535) {
      throw InvalidPortException(name, port)
    }
  }
}

private val threads: ExecutorService = Executors.newCachedThreadPool { runnable ->
  Thread(runnable, "willow-tunnel").apply { isDaemon = true }
}

private class Tunnel private constructor(
  private val localPort: Int,
  @Volatile private var remote: Remote,
  private val server: ServerSocket
) : Closeable {
  private val connections = ConcurrentHashMap.newKeySet<Connection>()

  @Volatile
  private var closed = false

  val isListening: Boolean
    get() = !closed && !server.isClosed

  fun retarget(next: Remote) {
    if (next == remote) {
      return
    }
    remote = next
    // Sockets already open still lead to the old remote.
    connections.forEach { it.close() }
  }

  private fun acceptInBackground() {
    threads.execute {
      while (!closed) {
        val client = try {
          server.accept()
        } catch (e: IOException) {
          if (!closed) {
            Log.w(TAG, "Stopped accepting on 127.0.0.1:$localPort", e)
            close()
          }
          break
        }
        val connection = Connection(client, remote)
        connections.add(connection)
        threads.execute {
          try {
            connection.run()
          } finally {
            connections.remove(connection)
          }
        }
      }
    }
  }

  override fun close() {
    closed = true
    closeQuietly(server)
    connections.forEach { it.close() }
    connections.clear()
  }

  companion object {
    fun open(localPort: Int, remote: Remote): Tunnel {
      val server = ServerSocket()
      try {
        server.reuseAddress = true
        server.bind(InetSocketAddress(InetAddress.getByName("127.0.0.1"), localPort), BACKLOG)
      } catch (e: IOException) {
        closeQuietly(server)
        throw TunnelBindException(localPort, e)
      }
      return Tunnel(localPort, remote, server).also { it.acceptInBackground() }
    }
  }
}

/**
 * One accepted socket and its upstream twin. Bytes are copied as they arrive, so
 * HTTP, Server-Sent Events and WebSockets pass through unchanged. An end of stream
 * is handed on as a half-close; an error on either side closes both.
 */
private class Connection(private val client: Socket, private val remote: Remote) : Closeable {
  private val upstream = Socket()
  private val closed = AtomicBoolean(false)
  private val openDirections = AtomicInteger(2)

  fun run() {
    try {
      client.tcpNoDelay = true
      upstream.tcpNoDelay = true
      upstream.keepAlive = true
      upstream.connect(InetSocketAddress(remote.host, remote.port), CONNECT_TIMEOUT_MS)
    } catch (e: IOException) {
      close()
      return
    }
    threads.execute { pump(upstream, client) }
    pump(client, upstream)
  }

  private fun pump(from: Socket, to: Socket) {
    val buffer = ByteArray(BUFFER_SIZE)
    try {
      val input = from.getInputStream()
      val output = to.getOutputStream()
      while (true) {
        val count = input.read(buffer)
        if (count < 0) {
          break
        }
        output.write(buffer, 0, count)
      }
      try {
        to.shutdownOutput()
      } catch (ignored: IOException) {
      }
      if (openDirections.decrementAndGet() == 0) {
        close()
      }
    } catch (ignored: IOException) {
      close()
    }
  }

  override fun close() {
    if (closed.compareAndSet(false, true)) {
      closeQuietly(client)
      closeQuietly(upstream)
    }
  }
}

private fun closeQuietly(closeable: Closeable) {
  try {
    closeable.close()
  } catch (ignored: IOException) {
  }
}
