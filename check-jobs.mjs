import prisma from './app/db.server.js';
const jobs = await prisma.bulkJob.findMany({ orderBy: { createdAt: 'desc' }, take: 5 });
console.log(jobs.map(j => ({ id: j.id, status: j.status, error: j.errorMessage }))); 
await prisma.$disconnect();
