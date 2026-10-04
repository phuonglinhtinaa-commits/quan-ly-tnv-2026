require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const Volunteer = require('./models/Volunteer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Kết nối MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// Middleware xác thực Admin
const verifyAdmin = (req, res, next) => {
  const password = req.headers['x-admin-password'] || req.body.adminPassword;
  if (password === ADMIN_PASSWORD) {
    next();
  } else {
    res.status(401).json({ success: false, message: 'Sai mật khẩu quản trị viên!' });
  }
};

// Chuẩn hóa nội dung tình nguyện
const normalizeActivityContent = (text) => {
  if (!text) return '';
  let clean = text.toLowerCase().trim();
  if (clean.includes('lao động')) return 'lao động';
  if (clean.includes('trực bàn') || clean.includes('trực ban')) return 'trực bàn';
  if (clean.includes('họp') || clean.includes('meeting')) return 'họp ban';
  return clean;
};

// --- API PUBLIC ---

// Form 1: Khởi tạo TNV
app.post('/api/volunteers/register', async (req, res) => {
  try {
    const { fullName, mssv } = req.body;
    if (!fullName || !mssv) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ Họ tên và MSSV!' });
    }
    let volunteer = await Volunteer.findOne({ mssv: mssv.trim().toUpperCase() });
    if (volunteer) {
      if (volunteer.status === 'approved') {
        return res.status(400).json({ success: false, message: 'MSSV này đã được đăng ký và phê duyệt trước đó!' });
      } else {
        return res.json({ success: true, message: 'Hồ sơ của bạn đang chờ phê duyệt!' });
      }
    }
    volunteer = new Volunteer({
      fullName: fullName.trim(),
      mssv: mssv.trim().toUpperCase(),
      status: 'pending'
    });
    await volunteer.save();
    res.json({ success: true, message: 'Đăng ký thành công! Đang chờ Quản trị viên phê duyệt.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Form 2: Ghi nhận tình nguyện
app.post('/api/volunteers/activity', async (req, res) => {
  try {
    const { fullName, mssv, content, date } = req.body;
    const volunteer = await Volunteer.findOne({ 
      mssv: mssv.trim().toUpperCase(), 
      fullName: { $regex: new RegExp(`^${fullName.trim()}$`, 'i') },
      status: 'approved'
    });
    if (!volunteer) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy TNV hoặc tài khoản chưa được phê duyệt!' });
    }
    volunteer.activities.push({ content: content.trim(), date });
    await volunteer.save();
    res.json({ success: true, message: 'Ghi nhận buổi tình nguyện thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Form 3: Admin cập nhật Vi phạm / Ghi chú / Thành tích
app.post('/api/volunteers/admin-update', verifyAdmin, async (req, res) => {
  try {
    const { mssv, fullName, updateType, valueData } = req.body;
    const query = { mssv: mssv.trim().toUpperCase() };
    if (fullName) query.fullName = { $regex: new RegExp(`^${fullName.trim()}$`, 'i') };

    const volunteer = await Volunteer.findOne(query);
    if (!volunteer) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin TNV!' });
    }

    if (updateType === 'fault') {
      volunteer.faults.push({ fault: valueData.fault, date: valueData.date });
    } else if (updateType === 'note') {
      volunteer.generalNote = valueData.generalNote;
    } else if (updateType === 'achievement') {
      const campaign = volunteer.campaigns.find(c => c.campaignName.toLowerCase() === valueData.campaignName.toLowerCase());
      if (campaign) {
        campaign.achievement = valueData.achievement;
      } else {
        volunteer.campaigns.push({ campaignName: valueData.campaignName, achievement: valueData.achievement });
      }
    }
    await volunteer.save();
    res.json({ success: true, message: 'Cập nhật thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Form 4: Đăng ký Chiến dịch lớn
app.post('/api/volunteers/campaign', async (req, res) => {
  try {
    const { fullName, mssv, campaignName } = req.body;
    const volunteer = await Volunteer.findOne({ 
      mssv: mssv.trim().toUpperCase(),
      status: 'approved'
    });
    if (!volunteer) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy TNV hoặc chưa được phê duyệt!' });
    }
    const exists = volunteer.campaigns.some(c => c.campaignName.toLowerCase() === campaignName.trim().toLowerCase());
    if (exists) {
      return res.status(400).json({ success: false, message: 'Bạn đã đăng ký chiến dịch này rồi!' });
    }
    volunteer.campaigns.push({ campaignName: campaignName.trim(), achievement: '' });
    await volunteer.save();
    res.json({ success: true, message: 'Đăng ký chiến dịch thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Form 5: Tra cứu thành tích cá nhân
app.post('/api/volunteers/search', async (req, res) => {
  try {
    const { fullName, mssv } = req.body;
    const volunteer = await Volunteer.findOne({ 
      mssv: mssv.trim().toUpperCase(),
      fullName: { $regex: new RegExp(`^${fullName.trim()}$`, 'i') },
      status: 'approved'
    });
    if (!volunteer) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy hồ sơ hoặc chưa được phê duyệt!' });
    }
    res.json({ success: true, data: volunteer });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// --- API DASHBOARD ADMIN ---

app.post('/api/admin/volunteers', verifyAdmin, async (req, res) => {
  try {
    const list = await Volunteer.find().sort({ createdAt: -1 });
    const processed = list.map(v => {
      let obj = v.toObject();
      const groupMap = {};
      obj.activities.forEach(act => {
        const key = normalizeActivityContent(act.content);
        if (!groupMap[key]) groupMap[key] = { groupName: act.content, count: 0, items: [] };
        groupMap[key].count += 1;
        groupMap[key].items.push(act);
      });
      obj.activitySummary = Object.values(groupMap);
      return obj;
    });
    res.json({ success: true, data: processed });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/approve', verifyAdmin, async (req, res) => {
  try {
    const { id, action } = req.body;
    if (action === 'approve') {
      await Volunteer.findByIdAndUpdate(id, { status: 'approved' });
      res.json({ success: true, message: 'Đã phê duyệt tình nguyện viên!' });
    } else if (action === 'reject') {
      await Volunteer.findByIdAndDelete(id);
      res.json({ success: true, message: 'Đã từ chối và xóa hồ sơ!' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/delete-item', verifyAdmin, async (req, res) => {
  try {
    const { volunteerId, itemType, itemId } = req.body;
    let updateQuery = {};
    if (itemType === 'activity') updateQuery = { $pull: { activities: { _id: itemId } } };
    if (itemType === 'fault') updateQuery = { $pull: { faults: { _id: itemId } } };
    if (itemType === 'campaign') updateQuery = { $pull: { campaigns: { _id: itemId } } };

    await Volunteer.findByIdAndUpdate(volunteerId, updateQuery);
    res.json({ success: true, message: 'Đã xóa mục thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
