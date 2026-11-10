import {initializeApp,getApps} from 'firebase/app';
import {getAuth,connectAuthEmulator} from 'firebase/auth';
export function firebaseAuth(){const app=getApps()[0]||initializeApp({apiKey:process.env.NEXT_PUBLIC_FIREBASE_API_KEY,authDomain:process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,projectId:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID});const auth=getAuth(app);if(process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL&&!(auth as any)._emulatorConfigured){connectAuthEmulator(auth,process.env.NEXT_PUBLIC_AUTH_EMULATOR_URL);(auth as any)._emulatorConfigured=true;}return auth;}
