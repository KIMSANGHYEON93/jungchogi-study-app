import { useEffect } from 'react';
import { addStudyTime } from '../utils/storage';

export default function useStudyTimer() {
  useEffect(() => {
    const start = Date.now();
    return () => {
      const elapsed = Math.round((Date.now() - start) / 60000);
      if (elapsed >= 1) addStudyTime(elapsed);
    };
  }, []);
}
