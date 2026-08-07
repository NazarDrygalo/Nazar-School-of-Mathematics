type Resource = { name: string; href: string; description: string }

const sections: { title: string; introduction: string; guidance: string[]; resources: Resource[] }[] = [
  { title: 'Math', introduction: 'Use outside practice to reinforce a specific skill, not to replace careful instruction or rush ahead.', guidance: ['Write each step so errors are easier to find.', 'After correcting a problem, solve a similar one without looking at the example.'], resources: [
    { name: 'Khan Academy Math', href: 'https://www.khanacademy.org/math', description: 'Free lessons and practice from middle-school math through advanced high-school courses.' },
    { name: 'Khan Academy Get Ready courses', href: 'https://www.khanacademy.org/math/get-ready-courses', description: 'Focused review of prerequisite skills before a new grade or course.' }
  ] },
  { title: 'Science', introduction: 'Science becomes clearer when students connect vocabulary, models, evidence, and calculations.', guidance: ['Before using a formula, name what each quantity represents and include units.', 'After a simulation or lab, explain what changed, what stayed controlled, and why.'], resources: [
    { name: 'Khan Academy Science', href: 'https://www.khanacademy.org/science', description: 'Free course material in biology, chemistry, physics, and related subjects.' },
    { name: 'PhET Interactive Simulations', href: 'https://phet.colorado.edu/en/', description: 'Free research-based math and science simulations from the University of Colorado Boulder.' }
  ] },
  { title: 'Essay Writing', introduction: 'Strong essays are built through planning, drafting, revising, and careful attention to the assignment.', guidance: ['State the main claim in one sentence before drafting body paragraphs.', 'Revise for ideas and organization first; proofread sentences and punctuation afterward.'], resources: [
    { name: 'Purdue OWL: The Writing Process', href: 'https://owl.purdue.edu/owl/general_writing/the_writing_process/index.html', description: 'Guidance on prewriting, thesis development, outlining, drafting, and revision.' },
    { name: 'Purdue OWL: Grammar', href: 'https://owl.purdue.edu/owl/general_writing/grammar/index.html', description: 'Clear references for common grammar questions and sentence-level revision.' }
  ] },
  { title: 'Parent Support', introduction: 'A simple, consistent routine and clear communication with the student and school are more useful than constant monitoring.', guidance: ['Ask the student to explain what they understand before stepping in.', 'Keep the tutor informed about major assignments, assessment dates, and changes in the school course.'], resources: [
    { name: 'U.S. Department of Education: Family Partnership', href: 'https://www.ed.gov/birth-grade-12-education/resources-families/family-partnership-and-engagement', description: 'Federal information and links for families supporting K–12 students.' },
    { name: 'Be A Learning Hero', href: 'https://bealearninghero.org/', description: 'Family-facing tools for understanding grade-level expectations and working with schools.' }
  ] }
]

export function Resources() {
  return <><section className="page-hero"><p className="eyebrow">Learning resources</p><h1>Useful places to practice and prepare.</h1><p>A short collection of free, reputable resources for students and families. Use them alongside schoolwork and the student’s tutoring plan.</p></section><section className="resources-section">{sections.map((section, index) => <article className="resource-group" key={section.title}><div className="resource-heading"><span>{String(index + 1).padStart(2, '0')}</span><div><h2>{section.title}</h2><p>{section.introduction}</p></div></div><div className="resource-content"><h3>Good habits</h3><ul>{section.guidance.map(item => <li key={item}>{item}</li>)}</ul><h3>Free external resources</h3><div className="resource-links">{section.resources.map(resource => <a key={resource.href} href={resource.href} target="_blank" rel="noreferrer"><b>{resource.name}<span aria-hidden="true"> ↗</span></b><small>{resource.description}</small></a>)}</div></div></article>)}</section><section className="resource-note"><div><p className="eyebrow">A thoughtful starting point</p><h2>Resources work best when they match the student’s current goal.</h2><p>Families are welcome to ask which type of review or practice would be most appropriate.</p></div><a className="button button-light" href="/contact">Contact the school</a></section></>
}
