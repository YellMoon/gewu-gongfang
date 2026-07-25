/**
 * 题库管理模块入口
 * 聚合所有题库相关路由
 */
const express = require('express');
const router = express.Router();

// 导入各子路由
const subjectsRouter = require('./routes/subjects');
const chaptersRouter = require('./routes/chapters');
const knowledgePointsRouter = require('./routes/knowledge_points');
const questionsRouter = require('./routes/questions');
const questionSetsRouter = require('./routes/question_sets');
const recordsRouter = require('./routes/records');
const parseWordRouter = require('./routes/parse_word');

// 挂载子路由 (去掉 /question-bank 前缀)
router.use('/subjects', subjectsRouter);
router.use('/chapters', chaptersRouter);
router.use('/knowledge-points', knowledgePointsRouter);
router.use('/questions', questionsRouter);
router.use('/question-sets', questionSetsRouter);
router.use('/records', recordsRouter);
router.use('/parse-word', parseWordRouter);

module.exports = router;
