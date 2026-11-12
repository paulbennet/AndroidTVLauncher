package com.weblauncher.tv

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import javax.net.ssl.SSLSocketFactory

/** Downloads reach only public hosts, also when a DNS-rebinding name resolves to a LAN address at connect time. */
class PublicNetTest {
    private fun ip(s: String) = InetAddress.getByName(s) // literals: no DNS lookup

    @Test fun publicAndPrivateAddresses() {
        for (a in listOf("8.8.8.8", "185.199.108.153", "2606:4700::1111")) assertTrue(a, PublicNet.isPublic(ip(a)))
        for (a in listOf("127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.20", "169.254.1.1", "100.64.0.1", "0.0.0.0",
            "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:192.168.1.1")) assertFalse(a, PublicNet.isPublic(ip(a)))
    }

    /** The guard looks at the socket's real peer, not at the name: a rebinding host can't get past it. */
    @Test fun guardRefusesAConnectionToAPrivatePeer() {
        ServerSocket(0, 1, ip("127.0.0.1")).use { server ->
            val raw = Socket(server.inetAddress, server.localPort)
            val guard = PublicNet.Guard(SSLSocketFactory.getDefault() as SSLSocketFactory)
            try {
                guard.createSocket(raw, "skins.example.com", 443, true)
                fail("a loopback peer must be refused")
            } catch (e: PublicNet.PrivateAddress) {
                assertEquals(ip("127.0.0.1"), e.address)
            }
            assertTrue("the socket is closed", raw.isClosed)
        }
    }
}
