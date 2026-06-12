import React, { useState, useEffect } from 'react';
import {
  Table, Button, Form, Input,
  Space, message, Popconfirm, Statistic
} from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, EnvironmentOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { Room } from '../types';
import DataPageLayout from '../layout/DataPageLayout';

const RoomManager: React.FC = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [form] = Form.useForm();
  const dbService = (window as any).dbService;

  const loadData = () => {
    if (!dbService) return;
    const roomsData = dbService.getAllRooms?.() || [];
    const coursesData = dbService.getAllCourses?.() || [];
    setRooms([...roomsData]);
    setCourses([...coursesData]);
  };

  useEffect(() => { loadData(); }, []);

  const handleAdd = () => {
    setEditingRoom(null);
    form.resetFields();
    setModalVisible(true);
  };

  const handleEdit = (room: Room) => {
    setEditingRoom(room);
    form.setFieldsValue(room);
    setModalVisible(true);
  };

  const handleDelete = (id: string) => {
    if (dbService.deleteRoom) {
      dbService.deleteRoom(id);
      message.success('删除成功');
      loadData();
    }
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      if (editingRoom) {
        if (dbService.updateRoom) {
          dbService.updateRoom(editingRoom.id, values);
          message.success('更新成功');
        }
      } else {
        // 检查是否已存在同名地址
        if (rooms.find(r => r.name === values.name)) {
          message.warning('该地址已存在');
          return;
        }
        if (dbService.addOrUpdateRoom) {
          dbService.addOrUpdateRoom(values.name, values.address);
          message.success('添加成功');
        }
      }
      setModalVisible(false);
      loadData();
    } catch (error: any) {
      if (error?.errorFields) return;
      console.error('验证失败:', error);
    }
  };

  const columns: ColumnsType<Room> = [
    {
      title: '上课地址',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      render: (text: string) => <><EnvironmentOutlined style={{ color: '#1890ff', marginRight: 6 }} />{text}</>,
    },
    {
      title: '关联课程数',
      dataIndex: 'count',
      key: 'count',
      width: 110,
      sorter: (a, b) => a.count - b.count,
      render: (count: number) => (
        <span style={{ color: count > 0 ? '#52c41a' : '#999' }}>{count} 门</span>
      ),
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 130,
      render: (time: string) => time ? new Date(time).toLocaleDateString('zh-CN') : '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space size="small">
          <Button type="link" icon={<EditOutlined />} onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除吗？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  // 统计关联课程数
  const roomWithCourseCount = rooms.map(r => {
    const courseCount = courses.filter((c: any) =>
      c.room_name === r.name || (c.room_id && c.room_id.includes(r.id))
    ).length;
    return { ...r, count: courseCount };
  });

  return (
    <DataPageLayout
      toolbar={(
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
          <Space size={18} wrap>
            <Statistic title="地址总数" value={rooms.length} />
            <Statistic
              title="关联课程数"
              value={courses.filter((c: any) => c.room_name || c.room_id).length}
            />
            <Statistic
              title="未关联课程数"
              value={courses.filter((c: any) => !c.room_name && !c.room_id).length}
            />
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>添加地址</Button>
        </div>
      )}
      table={(
        <Table
          columns={columns}
          dataSource={roomWithCourseCount}
          rowKey="id"
          pagination={{ pageSize: 20, showSizeChanger: true }}
        />
      )}
      drawerOpen={modalVisible}
      drawerTitle={editingRoom ? '编辑上课地址' : '添加上课地址'}
      onDrawerClose={() => setModalVisible(false)}
      destroyOnClose
      drawerFooter={(
        <div className="data-page-layout__drawer-footer">
          <Button onClick={() => setModalVisible(false)}>取消</Button>
          <Button type="primary" onClick={handleSubmit}>保存</Button>
        </div>
      )}
      drawerContent={(
        <Form form={form} layout="vertical">
          <Form.Item
            name="name"
            label="地址名称"
            rules={[{ required: true, message: '请输入上课地址' }]}
          >
            <Input placeholder="如：302教室、线上腾讯会议" />
          </Form.Item>
          <Form.Item name="address" label="详细地址">
            <Input placeholder="如：教学楼3楼302室（可选）" />
          </Form.Item>
        </Form>
      )}
    />
  );
};

export default RoomManager;
