// Cloudflare Pages Function: RFC 8484 DoH Sinkhole for Apple OCSP / Revocation domains
// Endpoint: https://vincenttrick.pages.dev/dns-query

function base64UrlToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function buildSinkholeDnsPacket(queryBytes) {
  if (!queryBytes || queryBytes.length < 17) return null;

  // Find end of QNAME starting at byte 12
  let pos = 12;
  while (pos < queryBytes.length && queryBytes[pos] !== 0) {
    const labelLen = queryBytes[pos];
    if ((labelLen & 0xc0) === 0xc0) {
      pos += 2;
      break;
    }
    pos += 1 + labelLen;
  }
  if (pos < queryBytes.length && queryBytes[pos] === 0) {
    pos += 1;
  }
  if (pos + 4 > queryBytes.length) return null;

  const qtype = (queryBytes[pos] << 8) | queryBytes[pos + 1];
  const qEnd = pos + 4;
  const questionSection = queryBytes.slice(12, qEnd);

  let answerBytes = new Uint8Array(0);
  let anCount = 0;

  if (qtype === 1) {
    // Type A -> 0.0.0.0 (TTL 3600)
    anCount = 1;
    answerBytes = new Uint8Array([
      0xc0, 0x0c,             // Name pointer to QNAME (offset 12)
      0x00, 0x01,             // Type A
      0x00, 0x01,             // Class IN
      0x00, 0x00, 0x0e, 0x10, // TTL 3600s
      0x00, 0x04,             // RDLENGTH 4
      0x00, 0x00, 0x00, 0x00  // 0.0.0.0
    ]);
  } else if (qtype === 28) {
    // Type AAAA -> :: (TTL 3600)
    anCount = 1;
    answerBytes = new Uint8Array([
      0xc0, 0x0c,             // Name pointer to QNAME
      0x00, 0x1c,             // Type AAAA
      0x00, 0x01,             // Class IN
      0x00, 0x00, 0x0e, 0x10, // TTL 3600s
      0x00, 0x10,             // RDLENGTH 16
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0
    ]);
  }

  const resp = new Uint8Array(12 + questionSection.length + answerBytes.length);
  // Transaction ID
  resp[0] = queryBytes[0];
  resp[1] = queryBytes[1];
  // Flags: QR=1, AA=1, RD=1, RA=1, RCODE=0 (0x8580)
  resp[2] = 0x85;
  resp[3] = 0x80;
  // QDCOUNT = 1
  resp[4] = 0x00;
  resp[5] = 0x01;
  // ANCOUNT
  resp[6] = 0x00;
  resp[7] = anCount;
  // NSCOUNT = 0, ARCOUNT = 0
  resp[8] = 0x00;
  resp[9] = 0x00;
  resp[10] = 0x00;
  resp[11] = 0x00;

  resp.set(questionSection, 12);
  if (answerBytes.length > 0) {
    resp.set(answerBytes, 12 + questionSection.length);
  }
  return resp;
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const accept = request.headers.get('Accept') || '';

  // Support JSON DoH queries for testing/verification
  if (url.searchParams.has('name') || accept.includes('application/dns-json')) {
    const name = url.searchParams.get('name') || 'ocsp.apple.com';
    const body = JSON.stringify({
      Status: 0,
      TC: false,
      RD: true,
      RA: true,
      AD: false,
      CD: false,
      Question: [{ name, type: 1 }],
      Answer: [{ name, type: 1, TTL: 3600, data: '0.0.0.0' }]
    });
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/dns-json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  let queryBytes = null;
  if (request.method === 'GET' && url.searchParams.has('dns')) {
    queryBytes = base64UrlToBytes(url.searchParams.get('dns'));
  } else if (request.method === 'POST') {
    const buf = await request.arrayBuffer();
    queryBytes = new Uint8Array(buf);
  }

  const respPacket = buildSinkholeDnsPacket(queryBytes);
  if (!respPacket) {
    return new Response('Bad DNS Request', { status: 400 });
  }

  return new Response(respPacket, {
    status: 200,
    headers: {
      'Content-Type': 'application/dns-message',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

