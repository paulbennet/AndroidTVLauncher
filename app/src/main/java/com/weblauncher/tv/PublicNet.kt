package com.weblauncher.tv

import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.Socket
import java.net.URL
import javax.net.ssl.SSLSocketFactory

/**
 * Downloads (skin links, the gallery) may reach only public internet hosts: the LAN page sends links on behalf of
 * anyone with the PIN, so the TV must not become a probe into the home network (router pages, other devices).
 *
 * Checking the name before the download is not enough: HttpURLConnection resolves it again, and a DNS-rebinding
 * host can answer with a LAN address the second time. So [guard] also checks the address the TV really connected
 * to, in the TLS layer, before a single byte is sent.
 */
object PublicNet {
    /** Thrown when the connection reached a non-public address. */
    class PrivateAddress(val address: InetAddress) : IOException("connected to a non-public address")

    fun isPublic(a: InetAddress): Boolean {
        if (a.isLoopbackAddress || a.isSiteLocalAddress || a.isLinkLocalAddress || a.isAnyLocalAddress || a.isMulticastAddress) return false
        val b = a.address
        if (a is Inet6Address && (b[0].toInt() and 0xfe) == 0xfc) return false // IPv6 unique local fc00::/7
        if (a is Inet4Address) {
            val b0 = b[0].toInt() and 0xff
            val b1 = b[1].toInt() and 0xff
            if (b0 == 100 && b1 in 64..127) return false // shared address space 100.64.0.0/10 (carrier NAT)
            if (b0 == 0) return false // "this network" 0.0.0.0/8
        }
        return true
    }

    /** Every address the name resolves to must be public (the fast check, before connecting). */
    fun publicHost(host: String): Boolean = runCatching { InetAddress.getAllByName(host).all(::isPublic) }.getOrDefault(false)

    /**
     * An SSLSocketFactory that refuses a connection to a non-public peer. HttpsURLConnection connects a plain socket
     * to the resolved address and then layers TLS on it through this factory, so the check sees the real peer.
     */
    class Guard(private val delegate: SSLSocketFactory) : SSLSocketFactory() {
        private fun check(s: Socket): Socket {
            val peer = s.inetAddress
            if (peer != null && !isPublic(peer)) { runCatching { s.close() }; throw PrivateAddress(peer) }
            return s
        }
        override fun createSocket(s: Socket, host: String?, port: Int, autoClose: Boolean): Socket =
            delegate.createSocket(check(s), host, port, autoClose)
        override fun createSocket(host: String?, port: Int): Socket = check(delegate.createSocket(host, port))
        override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
            check(delegate.createSocket(host, port, localHost, localPort))
        override fun createSocket(host: InetAddress?, port: Int): Socket = check(delegate.createSocket(host, port))
        override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket =
            check(delegate.createSocket(address, port, localAddress, localPort))
        override fun getDefaultCipherSuites(): Array<String> = delegate.defaultCipherSuites
        override fun getSupportedCipherSuites(): Array<String> = delegate.supportedCipherSuites
    }

    private val guard by lazy { Guard(SSLSocketFactory.getDefault() as SSLSocketFactory) }

    /**
     * The factory to use for `u`, or null when the peer can't be checked here: through a proxy the TV connects to
     * the proxy, and the proxy resolves the name (the name check before connecting still applies).
     */
    fun guardFor(u: URL): SSLSocketFactory? {
        val direct = runCatching { ProxySelector.getDefault()?.select(u.toURI())?.all { it.type() == Proxy.Type.DIRECT } ?: true }.getOrDefault(true)
        return if (direct) guard else null
    }
}
