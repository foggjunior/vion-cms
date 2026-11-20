import './globals.css';import {connection} from 'next/server';
export const metadata={title:'Vion Africa CMS',description:'Vion Africa Travel staff workspace',robots:{index:false,follow:false}};
// Staff pages render per request so the report-only CSP nonce from proxy.ts is applied to Next's scripts.
export default async function Layout({children}:{children:React.ReactNode}){await connection();return <html lang="en"><body>{children}</body></html>}
