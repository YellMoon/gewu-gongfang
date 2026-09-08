'use strict';
// UTF-8: same real draft/REST/PostgreSQL path with student tombstones, no mock writer.
require('./retained-course-schedule.postgres.test').run({studentDeleted:true}).catch(error=>{console.error(error);process.exitCode=1;});
