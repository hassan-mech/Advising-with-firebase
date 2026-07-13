import { Course, Student } from './types';

import { COURSES, MAJORS } from './courses';
export { COURSES, MAJORS };

// Seeded real list of students for cohort overview, tracking, and individual plan editing
export const INITIAL_STUDENTS: Student[] = [
  {
    id: '2024-8842',
    name: 'Jane Doe',
    avatar: 'JD',
    major: 'Biomedical Engineering',
    year: 3,
    creditsEarned: 92,
    totalCreditsRequired: 120,
    status: 'FINALIZED',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'MEC151', 'MEC111', 'PHY321', 'MAT211', 'ELE112', 'ELE113', 'ELE111', 'MEC131', 'MAT313', 'MEC253',
      'MEC252', 'MEC212', 'MEC251', 'MEC121', 'ELE271', 'ELE211', 'ELE212', 'BME211', 'MEC112', 'CSE014'
    ],
    plannedTerms: [
      { id: 'summer-2026', name: 'Summer 2026', courses: [] },
      { id: 'fall-2026', name: 'Fall 2026', courses: ['BME312', 'BME313', 'BME321', 'BME213'] },
      { id: 'spring-2027', name: 'Spring 2027', courses: ['ELE312', 'BME322', 'BME315'] },
      { id: 'fall-2027', name: 'Fall 2027', courses: ['MEC255', 'BME323', 'ELE322', 'BME491'] },
      { id: 'spring-2028', name: 'Spring 2028', courses: ['BME492', 'BME391'] }
    ],
    courseHistory: [
      { courseCode: 'MEC011', term: 'Fall 2023', grade: 'A', credits: 3 },
      { courseCode: 'PHY111', term: 'Fall 2023', grade: 'A', credits: 3 },
      { courseCode: 'MAT122', term: 'Fall 2023', grade: 'A-', credits: 3 },
      { courseCode: 'MAT111', term: 'Fall 2023', grade: 'A', credits: 3 },
    ]
  },
  {
    id: '2024-9102',
    name: 'Marcus Smith',
    avatar: 'MS',
    major: 'Mechatronics Engineering',
    year: 4,
    creditsEarned: 112,
    totalCreditsRequired: 128,
    status: 'IN-PROGRESS',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'MEC111', 'MEC151', 'PHY321', 'MAT211', 'ELE112', 'MEC131', 'ELE111', 'MEC112', 'ELE271', 'MEC121',
      'MEC212', 'MEC252', 'MEC251', 'MAT221', 'MAT313', 'MEC211', 'MEC213', 'MEC253', 'MEC271', 'MEC341',
      'MEC329', 'MEC342', 'CSE014', 'MEC361', 'ELE384', 'MEC372', 'MEC375', 'MEC472'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['MEC471', 'MEC445', 'MEC491'] },
      { id: 'spring-2027', name: 'Spring 2027', courses: ['MEC492', 'MEC391'] }
    ]
  },
  {
    id: '2024-4431',
    name: 'Alice Lee',
    avatar: 'AL',
    major: 'Environmental Architecture',
    year: 1,
    creditsEarned: 14,
    totalCreditsRequired: 140,
    status: 'MISSING REQS', // Alert as MEC012 is taken without MEC011 or missing required path
    completedCourses: [
      'PHY111', 'MAT122', 'MAT111', 'MEC041', 'CHE142', 'MAT112'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['MEC012', 'MEC011'] } // taking both together (warning)
    ]
  },
  {
    id: '2024-5512',
    name: 'Raj Kapoor',
    avatar: 'RK',
    major: 'Civil Engineering',
    year: 2,
    creditsEarned: 45,
    totalCreditsRequired: 120,
    status: 'DRAFT',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'PHY231', 'CIV113', 'CIV111', 'CIV112', 'CIV114'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['CIV211', 'CIV212', 'CIV131'] },
      { id: 'spring-2027', name: 'Spring 2027', courses: ['CIV213', 'CIV216', 'CIV221'] }
    ]
  },
  {
    id: '2024-1102',
    name: 'Sarah Jenkins',
    avatar: 'SJ',
    major: 'Petrol and Gas Engineering',
    year: 2,
    creditsEarned: 38,
    totalCreditsRequired: 120,
    status: 'DRAFT',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['MEC151', 'MEC111', 'PHY321', 'MAT211'] }
    ]
  },
  {
    id: '2024-7741',
    name: 'David Chen',
    avatar: 'DC',
    major: 'Aerospace Engineering',
    year: 4,
    creditsEarned: 118,
    totalCreditsRequired: 128,
    status: 'FINALIZED',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'MEC111', 'MEC151', 'PHY321', 'MAT211', 'ELE112', 'MEC131', 'ELE111', 'ELE271', 'MEC112', 'MEC121',
      'MEC212', 'MEC252', 'MEC253', 'MAT221', 'MEC211', 'MEC213', 'MEC251', 'MEC271', 'MEC281', 'MEC341',
      'MEC321', 'MEC351', 'CSE272', 'MEC262', 'MEC343', 'MEC345', 'MEC383', 'MEC384', 'MEC391'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['MEC255', 'MEC491'] },
      { id: 'spring-2027', name: 'Spring 2027', courses: ['MEC492'] }
    ]
  },
  {
    id: '2024-3498',
    name: 'Elena Rostova',
    avatar: 'ER',
    major: 'Environmental Architecture',
    year: 3,
    creditsEarned: 78,
    totalCreditsRequired: 140,
    status: 'IN-PROGRESS',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'MEC151', 'PHY321', 'ARC111', 'ARC131', 'ARC141', 'CIV113', 'CIV112', 'CIV131', 'ARC121', 'ARC132',
      'CIV211', 'ARC233', 'ARC242', 'ARC271', 'CIV212', 'ARC212'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['ARC222', 'ARC223', 'ARC234'] },
      { id: 'spring-2027', name: 'Spring 2027', courses: ['ARC235', 'ARC373'] }
    ]
  },
  {
    id: '2024-2201',
    name: 'Omar Farooq',
    avatar: 'OF',
    major: 'Petrol and Gas Engineering',
    year: 4,
    creditsEarned: 115,
    totalCreditsRequired: 120,
    status: 'MISSING REQS', // Alert because missing chemistry prerequisites for petroleum process or reservoir simulation
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'MEC151', 'MEC111', 'PHY321', 'MAT211', 'ELE112', 'MEC252', 'MEC121', 'MEC131', 'MEC253', 'ELE271',
      'MEC212', 'MEC251', 'MEC341', 'PGE231', 'MEC353', 'MEC255', 'PGE212', 'CSE014', 'MEC355', 'PGE221',
      'PGE371', 'PGE391', 'PGE355', 'PGE213', 'PGE311', 'PGE312', 'PGE313', 'PGE314'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['PGE232'] }, // needs Organic Chemistry (CHE111) first (prereq warning)
      { id: 'spring-2027', name: 'Spring 2027', courses: ['PGE491', 'PGE492'] }
    ]
  },
  {
    id: '2024-4015',
    name: 'Taylor Vance',
    avatar: 'TV',
    major: 'Mechatronics Engineering',
    year: 3,
    creditsEarned: 84,
    totalCreditsRequired: 128,
    status: 'FINALIZED',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'MEC111', 'MEC151', 'PHY321', 'MAT211', 'ELE112', 'MEC131', 'ELE111', 'ELE271', 'MEC121', 'MEC212',
      'MEC252', 'MEC251', 'MAT221', 'MAT313'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['MEC211', 'MEC213', 'MEC253'] },
      { id: 'spring-2027', name: 'Spring 2027', courses: ['MEC271', 'MEC341'] }
    ]
  },
  {
    id: '2024-6119',
    name: 'Chloe Miller',
    avatar: 'CM',
    major: 'Biomedical Engineering',
    year: 2,
    creditsEarned: 52,
    totalCreditsRequired: 120,
    status: 'IN-PROGRESS',
    completedCourses: [
      'MEC011', 'PHY111', 'MAT122', 'MAT111', 'MEC012', 'MEC041', 'CHE142', 'MAT112', 'MAT121', 'PHY211',
      'MEC111', 'MEC151', 'PHY321', 'MAT211', 'ELE112', 'ELE113', 'ELE111', 'MEC131', 'MAT313'
    ],
    plannedTerms: [
      { id: 'fall-2026', name: 'Fall 2026', courses: ['MEC253', 'MEC252', 'MEC212', 'MEC251'] },
      { id: 'spring-2027', name: 'Spring 2027', courses: ['MEC121', 'ELE271'] }
    ]
  }
];

// Helper to expand the student list to exactly 128 students for realistic cohort overview statistics
export const getFullCohortStudents = (): Student[] => {
  const list = [...INITIAL_STUDENTS];
  const firstNames = ['John', 'Robert', 'William', 'James', 'Thomas', 'Michael', 'Emily', 'Emma', 'Olivia', 'Sophia', 'Isabella', 'Mia', 'Lucas', 'Ethan', 'Aria', 'Layla', 'Alex', 'Liam', 'Noah', 'Zoe', 'Aiden', 'Mia', 'Yousuf', 'Karim', 'Fatima', 'Nour', 'Laila', 'Zain', 'Samer', 'Malik'];
  const lastNames = ['Smith', 'Jones', 'Williams', 'Brown', 'Davis', 'Miller', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson', 'White', 'Harris', 'Martin', 'Garcia', 'Martinez', 'Robinson', 'Clark', 'Rodriguez', 'Mansour', 'El-Amin', 'Hassan', 'Abdel-Rahman', 'Gaber', 'Ibrahim'];

  const yearsByMajor: Record<string, number> = {
    'Petrol and Gas Engineering': 120,
    'Environmental Architecture': 140,
    'Aerospace Engineering': 128,
    'Civil Engineering': 120,
    'Mechatronics Engineering': 128,
    'Biomedical Engineering': 120
  };

  let currentIdNum = 3500;
  while (list.length < 128) {
    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const name = `${fn} ${ln}`;
    const id = `2024-${currentIdNum++}`;
    const major = MAJORS[Math.floor(Math.random() * MAJORS.length)];
    const year = Math.floor(Math.random() * 4) + 1; // 1 to 4
    const totalReq = yearsByMajor[major];
    
    // Assign credits earned based on year
    let creditsEarned = 15;
    if (year === 2) creditsEarned = 35 + Math.floor(Math.random() * 20);
    else if (year === 3) creditsEarned = 65 + Math.floor(Math.random() * 25);
    else if (year === 4) creditsEarned = 95 + Math.floor(Math.random() * 25);
    else creditsEarned = Math.floor(Math.random() * 18);

    const statuses: Array<'FINALIZED' | 'IN-PROGRESS' | 'MISSING REQS' | 'DRAFT'> = ['FINALIZED', 'IN-PROGRESS', 'MISSING REQS', 'DRAFT'];
    const statusIdx = Math.floor(Math.random() * 4);
    // Weight statuses so that in-progress is most common, missing is less common
    const statusWeight = [0.15, 0.45, 0.10, 0.30];
    let rand = Math.random();
    let status: 'FINALIZED' | 'IN-PROGRESS' | 'MISSING REQS' | 'DRAFT' = 'IN-PROGRESS';
    let cumulative = 0;
    for (let i = 0; i < statuses.length; i++) {
      cumulative += statusWeight[i];
      if (rand <= cumulative) {
        status = statuses[i];
        break;
      }
    }

    // Assign some typical completed courses based on credits
    const majorCourses = COURSES.filter(c => c.category === major || c.category === 'Core Engineering');
    const sortedMajorCodes = majorCourses.map(c => c.code);
    const completedCount = Math.floor(creditsEarned / 3);
    const completedCourses = sortedMajorCodes.slice(0, completedCount);

    const plannedCount = Math.floor((totalReq - creditsEarned) / 3);
    const plannedCodes = sortedMajorCodes.slice(completedCount, completedCount + Math.min(plannedCount, 6));

    const plannedTerms = [
      { id: 'summer-2026', name: 'Summer 2026', courses: plannedCodes.slice(0, 2) },
      { id: 'fall-2026', name: 'Fall 2026', courses: plannedCodes.slice(2, 5) },
      { id: 'spring-2027', name: 'Spring 2027', courses: plannedCodes.slice(5, 8) }
    ];

    list.push({
      id,
      name,
      avatar: `${fn[0]}${ln[0]}`,
      major,
      year,
      creditsEarned,
      totalCreditsRequired: totalReq,
      status,
      completedCourses,
      plannedTerms
    });
  }

  return list;
};
