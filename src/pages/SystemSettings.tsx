import React, { useState, useEffect } from 'react';
import { Card, Button, message, Space, Divider, Popconfirm, Typography } from 'antd';
import { ExportOutlined, ImportOutlined, DeleteOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { APP_VERSION } from '../generated/version';

const { Text } = Typography;

const SystemSettings: React.FC = () => {
  const dbService = (window as any).dbService;
  
  const handleResetData = () => {
    if (!dbService) {
      message.error('系统未加载完成');
      return;
    }
    try {
      // 重置为默认数据结构
      const defaultData = {
        students: [],
        grades: [],
        courses: [],
        schedules: [],
        enrollments: [],
        payments: [],
        consumptions: [],
        institutions: [],
        schools: [],
        teachers: []
      };
      dbService.importAllData(defaultData);
      message.success('数据重置成功');
    } catch (error: any) {
      message.error('重置失败：' + error.message);
    }
  };

  const handleExport = () => {
    if (!dbService) {
      message.error('系统未加载完成');
      return;
    }
    try {
      const data = dbService.exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
      a.click();
      URL.revokeObjectURL(url);
      message.success('数据导出成功');
    } catch (error: any) {
      message.error('导出失败：' + error.message);
    }
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event: any) => {
          try {
            const data = JSON.parse(event.target.result);
            dbService.importAllData(data);
            message.success('数据导入成功');
          } catch (error: any) {
            message.error('导入失败：' + error.message);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  return (
    <div>
      <Card title="数据管理" style={{ marginBottom: 16 }}>
        <Space size="large" wrap>
          <div>
            <Button 
              type="primary" 
              icon={<ExportOutlined />} 
              size="large"
              onClick={handleExport}
            >
              导出全部数据
            </Button>
            <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>
              <Text type="secondary">导出所有数据（学生、课程、老师、学校、机构、排课、缴费记录等），可用于备份和迁移</Text>
            </div>
          </div>
          <Button 
            icon={<ImportOutlined />} 
            size="large"
            onClick={handleImport}
          >
            导入数据
          </Button>
          <Button 
            icon={<ReloadOutlined />} 
            size="large"
            onClick={handleResetData}
          >
            重置所有数据
          </Button>
          <Popconfirm
            title="确定要清除所有数据吗？"
            description="此操作不可恢复！"
            onConfirm={() => {
              const emptyData = {
                students: [],
                grades: [],
                courses: [],
                schedules: [],
                enrollments: [],
                payments: [],
                consumptions: [],
                institutions: [],
                schools: [],
                teachers: []
              };
              dbService.importAllData(emptyData);
              message.success('数据已清除');
            }}
            okText="确定"
            cancelText="取消"
          >
            <Button 
              danger
              icon={<DeleteOutlined />} 
              size="large"
            >
              清除所有数据
            </Button>
          </Popconfirm>
        </Space>
        <Divider />
        <div style={{ color: '#666', lineHeight: '1.8' }}>
          <p>• 导出功能将把所有学生、课程、排课、财务数据保存为 JSON 文件</p>
          <p>• 导入功能可从备份文件恢复数据（注意：会覆盖现有数据）</p>
          <p>• 建议定期导出备份，方便跨电脑转移</p>
          <p>• 导出调用 dbService.exportAllData()，覆盖 students、courses、teachers、schools、institutions、schedules、payments、consumptions、enrollments、grades 等全部数据表</p>
        </div>
      </Card>

      <Card title="系统信息">
        <div style={{ color: '#666', lineHeight: '1.8' }}>
          <p>• 版本：v{APP_VERSION}</p>
          <p>• 数据库：浏览器本地存储 (IndexedDB/LocalStorage)</p>
          <p>• 数据位置：浏览器 localStorage key: scheduling_system_db_v3</p>
          <p>• 更新日期：{dayjs().format('YYYY-MM-DD')}</p>
          <p>• 软件作者：小龙虾</p>
        </div>
      </Card>
    </div>
  );
};

export default SystemSettings;
