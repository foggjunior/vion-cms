// Staff-only application: nothing here should be indexed or embedded. X-Robots-Tag covers every
// response (pages, APIs and static files); HSTS applies once served over HTTPS.
const security=[{key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},{key:'X-Frame-Options',value:'DENY'},{key:'X-Content-Type-Options',value:'nosniff'},{key:'X-Robots-Tag',value:'noindex, nofollow, noarchive'},{key:'Strict-Transport-Security',value:'max-age=31536000; includeSubDomains'},{key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=(), usb=()'}];
// Staff APIs are never cached. /api/public/* is excluded so its own CDN policy (server/public-feed.mjs)
// applies instead of competing with no-store; the pattern was checked with Next's path-to-regexp.
const config={serverExternalPackages:['firebase-admin','fake-indexeddb','cloudinary','sharp'],poweredByHeader:false,outputFileTracingIncludes:{'/workspace':['./public/approved/index.html'],'/finance':['./finance/workspace.html']},async headers(){return [{source:'/:path*',headers:security},{source:'/api/:path((?!public/).*)',headers:[{key:'Cache-Control',value:'no-store'}]}]}};export default config;
