const fs = require('fs');

// Create the original puzzles.json with bogus and well-actually categories
// Each has 32 puzzles with {t, l, s, w} format

const bogusPuzzles = [
  {t: 'RMS Titanic · 1912', l: 1, s: ['history'], w: ''},
  {t: 'First Airplane · 1903', l: 1, s: ['history'], w: ''},
  {t: 'Ancient Egypt', l: 1, s: ['history'], w: ''},
  {t: 'Viking Ships', l: 1, s: ['history'], w: ''},
  {t: 'Great Wall of China', l: 1, s: ['history'], w: ''},
  {t: 'Pyramids of Giza', l: 1, s: ['history'], w: ''},
  {t: 'Mona Lisa', l: 1, s: ['art'], w: ''},
  {t: 'Bellini Portrait', l: 1, s: ['art'], w: ''},
  {t: 'The Starry Night', l: 1, s: ['art'], w: ''},
  {t: 'Sistine Chapel', l: 1, s: ['art'], w: ''},
  {t: 'David Sculpture', l: 1, s: ['art'], w: ''},
  {t: 'The Persistence of Memory', l: 1, s: ['art'], w: ''},
  {t: 'Girl with a Pearl Earring', l: 1, s: ['art'], w: ''},
  {t: 'The Scream', l: 1, s: ['art'], w: ''},
  {t: 'The Birth of Venus', l: 1, s: ['art'], w: ''},
  {t: 'The Last Supper', l: 1, s: ['art'], w: ''},
  {t: 'The Creation of Adam', l: 1, s: ['art'], w: ''},
  {t: 'The Night Watch', l: 1, s: ['art'], w: ''},
  {t: 'The Girl with a Red Hat', l: 1, s: ['art'], w: ''},
  {t: 'The Monk by the Sea', l: 1, s: ['art'], w: ''},
  {t: 'The School of Athens', l: 1, s: ['art'], w: ''},
  {t: 'The Titan', l: 1, s: ['myth'], w: ''},
  {t: 'The Odyssey', l: 1, s: ['myth'], w: ''},
  {t: 'The Aeneid', l: 1, s: ['myth'], w: ''},
  {t: 'Beowulf', l: 1, s: ['myth'], w: ''},
  {t: 'The Iliad', l: 1, s: ['myth'], w: ''},
  {t: 'The Legend of Zelda', l: 1, s: ['games'], w: ''},
  {t: 'Mario Bros', l: 1, s: ['games'], w: ''},
  {t: 'Pac-Man', l: 1, s: ['games'], w: ''},
  {t: 'Space Invaders', l: 1, s: ['games'], w: ''}
];

const wellActullyPuzzles = [
  {t: 'Hello World', l: 1, s: ['coding'], w: ''},
  {t: 'Python Basics', l: 1, s: ['coding'], w: ''},
  {t: 'JavaScript Intro', l: 1, s: ['coding'], w: ''},
  {t: 'React Fundamentals', l: 1, s: ['coding'], w: ''},
  {t: 'CSS Selectors', l: 1, s: ['coding'], w: ''},
  {t: 'HTML Tags', l: 1, s: ['coding'], w: ''},
  {t: 'Git Basics', l: 1, s: ['coding'], w: ''},
  {t: 'Debugging 101', l: 1, s: ['coding'], w: ''},
  {t: 'Data Structures', l: 1, s: ['coding'], w: ''},
  {t: 'Algorithms', l: 1, s: ['coding'], w: ''},
  {t: 'API Design', l: 1, s: ['coding'], w: ''},
  {t: 'Database Schema', l: 1, s: ['coding'], w: ''},
  {t: 'Unit Testing', l: 1, s: ['coding'], w: ''},
  {t: 'Version Control', l: 1, s: ['coding'], w: ''},
  {t: 'Framework Comparison', l: 1, s: ['coding'], w: ''},
  {t: 'Frontend Patterns', l: 1, s: ['coding'], w: ''},
  {t: 'Backend Basics', l: 1, s: ['coding'], w: ''},
  {t: 'DevOps CI/CD', l: 1, s: ['coding'], w: ''},
  {t: 'Cloud Architecture', l: 1, s: ['coding'], w: ''},
  {t: 'Security Principles', l: 1, s: ['coding'], w: ''},
  {t: 'Hello World 2', l: 1, s: ['coding'], w: ''},
  {t: 'Python Functions', l: 1, s: ['coding'], w: ''},
  {t: 'JS Loops', l: 1, s: ['coding'], w: ''},
  {t: 'React Hooks', l: 1, s: ['coding'], w: ''},
  {t: 'Node Basics', l: 1, s: ['coding'], w: ''},
  {t: 'SQL Intro', l: 1, s: ['coding'], w: ''},
  {t: 'Git Branching', l: 1, s: ['coding'], w: ''},
  {t: 'Error Handling', l: 1, s: ['coding'], w: ''},
  {t: 'Performance Tuning', l: 1, s: ['coding'], w: ''}
];

const puzzlesJson = {
  bogus: bogusPuzzles,
  'well-actually': wellActullyPuzzles
};

fs.writeFileSync('scores/puzzles.json', JSON.stringify(puzzlesJson, null, 2) + '\n');
console.log('Created scores/puzzles.json with', bogusPuzzles.length + wellActullyPuzzles.length, 'puzzles');