import {createRoot} from 'react-dom/client';
import {PhoneProvider} from '../../app/phone/phone';
createRoot(document.getElementById('root')!).render(<PhoneProvider appId="browser-fixture-only" configured/>);
