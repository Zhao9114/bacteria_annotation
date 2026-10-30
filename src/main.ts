import './styles.css';
import { mountAnnotateScreen } from './screens/annotate';

// Only the annotation screen exists so far. The library and comparison screens
// (milestones 6 and 11) will add a small router here.
const root = document.getElementById('app');
if (!root) throw new Error('#app element missing');
mountAnnotateScreen(root);
