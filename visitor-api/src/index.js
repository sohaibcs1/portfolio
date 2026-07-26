const ALLOWED_ORIGINS = new Set([
  'https://sohaibcs1.github.io',
  'http://localhost:4200'
]);

export default {
  async fetch(request, env) {
    const origin =
      request.headers.get('Origin') || '';

    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers
      });
    }

    try {
      const url = new URL(request.url);

      if (
        request.method === 'GET' &&
        url.pathname === '/'
      ) {
        return json(
          {
            ok: true,
            service: 'Sohaib Portfolio Visitor API'
          },
          headers
        );
      }

      if (
        request.method === 'POST' &&
        url.pathname === '/visit'
      ) {
        const stats = await recordVisit(
          request,
          env
        );

        return json(stats, headers);
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/visitors'
      ) {
        return json(
          await publicStats(env),
          headers
        );
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/visitor-map'
      ) {
        return json(
          await visitorMap(env, url),
          headers
        );
      }

      if (
        request.method === 'GET' &&
        url.pathname === '/health'
      ) {
        return json(
          {
            ok: true,
            databaseConnected: Boolean(env.DB)
          },
          headers
        );
      }

      return json(
        {
          error: 'Not found'
        },
        headers,
        404
      );
    } catch (error) {
      console.error(
        'Visitor service error:',
        error
      );

      return json(
        {
          error: 'Visitor service unavailable',
          message:
            error instanceof Error
              ? error.message
              : String(error)
        },
        headers,
        500
      );
    }
  }
};

async function recordVisit(request, env) {
  const now = new Date().toISOString();
  const visitDay = now.slice(0, 10);

  const ip =
    request.headers.get('CF-Connecting-IP') ||
    'local';

  const visitorKey = await sha256(
    `${
      env.HASH_SALT ||
      'local-development'
    }:${visitDay}:${ip}`
  );

  const cf = request.cf || {};

  const body = await request
    .json()
    .catch(() => ({}));

  const countryCode =
    cf.country || 'XX';

  const country =
    countryName(countryCode);

  await env.DB.prepare(`
    INSERT INTO visits (
      visitor_key,
      visit_day,
      city,
      region,
      country,
      country_code,
      pageviews,
      first_seen,
      last_seen,
      last_path,
      latitude,
      longitude
    )
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
    ON CONFLICT(visitor_key, visit_day)
    DO UPDATE SET
      pageviews = pageviews + 1,
      last_seen = excluded.last_seen,
      last_path = excluded.last_path,
      city = excluded.city,
      region = excluded.region,
      country = excluded.country,
      country_code = excluded.country_code,
      latitude = excluded.latitude,
      longitude = excluded.longitude
  `)
    .bind(
      visitorKey,
      visitDay,
      cf.city || 'Unknown',
      cf.region || '',
      country,
      countryCode,
      now,
      now,
      String(body.path || '/').slice(
        0,
        200
      ),
      numberOrNull(cf.latitude),
      numberOrNull(cf.longitude)
    )
    .run();

  return publicStats(env);
}

async function publicStats(env) {
  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const totals = await env.DB.prepare(`
    SELECT
      COALESCE(
        SUM(pageviews),
        0
      ) AS totalVisits,

      COUNT(
        DISTINCT CASE
          WHEN country_code != 'XX'
          THEN country_code
        END
      ) AS countries,

      COALESCE(
        SUM(
          CASE
            WHEN visit_day = ?
            THEN pageviews
            ELSE 0
          END
        ),
        0
      ) AS visitsToday
    FROM visits
  `)
    .bind(today)
    .first();

  const locations =
    await locationSummary(env, 30);

  return {
    totalVisits:
      Number(totals?.totalVisits || 0),

    countries:
      Number(totals?.countries || 0),

    visitsToday:
      Number(totals?.visitsToday || 0),

    locations
  };
}

async function visitorMap(env, url) {
  const days = clamp(
    url.searchParams.get('days'),
    1,
    3650,
    30
  );

  const page = clamp(
    url.searchParams.get('page'),
    1,
    100000,
    1
  );

  const limit = clamp(
    url.searchParams.get('limit'),
    1,
    50,
    10
  );

  const country =
    url.searchParams.get('country') || '';

  const city =
    url.searchParams.get('city') || '';

  const cutoff = new Date(
    Date.now() - days * 86400000
  ).toISOString();

  const where = `
    last_seen >= ?
    AND (? = '' OR country_code = ?)
    AND (? = '' OR city = ?)
  `;

  const bindings = [
    cutoff,
    country,
    country,
    city,
    city
  ];

  const count = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM visits
    WHERE ${where}
  `)
    .bind(...bindings)
    .first();

  const result = await env.DB.prepare(`
    SELECT
      country_code AS countryCode,
      country,
      region,
      city,
      pageviews,
      last_seen AS visitedAt
    FROM visits
    WHERE ${where}
    ORDER BY last_seen DESC
    LIMIT ?
    OFFSET ?
  `)
    .bind(
      ...bindings,
      limit,
      (page - 1) * limit
    )
    .all();

  const today = new Date()
    .toISOString()
    .slice(0, 10);

  const summary = await env.DB.prepare(`
    SELECT
      COALESCE(
        SUM(pageviews),
        0
      ) AS totalVisits,

      COUNT(
        DISTINCT CASE
          WHEN country_code != 'XX'
          THEN country_code
        END
      ) AS countries,

      COALESCE(
        SUM(
          CASE
            WHEN visit_day = ?
            THEN pageviews
            ELSE 0
          END
        ),
        0
      ) AS visitsToday
    FROM visits
    WHERE last_seen >= ?
  `)
    .bind(
      today,
      cutoff
    )
    .first();

  return {
    summary: {
      totalVisits:
        Number(summary?.totalVisits || 0),

      countries:
        Number(summary?.countries || 0),

      visitsToday:
        Number(summary?.visitsToday || 0)
    },

    locations:
      await locationSummary(env, days),

    total:
      Number(count?.total || 0),

    visits:
      result.results || []
  };
}

async function locationSummary(
  env,
  days
) {
  const cutoff = new Date(
    Date.now() - days * 86400000
  ).toISOString();

  const result = await env.DB.prepare(`
    SELECT
      country_code AS countryCode,
      country,
      region,
      city,
      AVG(latitude) AS latitude,
      AVG(longitude) AS longitude,
      SUM(pageviews) AS visits
    FROM visits
    WHERE
      last_seen >= ?
      AND latitude IS NOT NULL
      AND longitude IS NOT NULL
    GROUP BY
      country_code,
      country,
      region,
      city
    ORDER BY visits DESC
    LIMIT 200
  `)
    .bind(cutoff)
    .all();

  return result.results || [];
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods':
      'GET,POST,OPTIONS',

    'Access-Control-Allow-Headers':
      'Content-Type',

    'Content-Type':
      'application/json',

    'Vary':
      'Origin'
  };

  if (ALLOWED_ORIGINS.has(origin)) {
    headers[
      'Access-Control-Allow-Origin'
    ] = origin;
  }

  return headers;
}

function json(
  value,
  headers,
  status = 200
) {
  return new Response(
    JSON.stringify(value),
    {
      status,
      headers
    }
  );
}

function clamp(
  value,
  min,
  max,
  fallback
) {
  const number = Number(value);

  return Number.isFinite(number)
    ? Math.min(
        max,
        Math.max(
          min,
          Math.floor(number)
        )
      )
    : fallback;
}

function numberOrNull(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

function countryName(code) {
  if (!code || code === 'XX') {
    return 'Unknown';
  }

  try {
    return (
      new Intl.DisplayNames(
        ['en'],
        {
          type: 'region'
        }
      ).of(code) || code
    );
  } catch {
    return code;
  }
}

async function sha256(value) {
  const bytes =
    new TextEncoder().encode(value);

  const digest =
    await crypto.subtle.digest(
      'SHA-256',
      bytes
    );

  return [
    ...new Uint8Array(digest)
  ]
    .map(byte =>
      byte
        .toString(16)
        .padStart(2, '0')
    )
    .join('');
}