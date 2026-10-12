require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const Volunteer = require('./models/Volunteer');

const app = express();
const PORT = process.env.PORT || 3000;

// Cấu hình 8 mật khẩu: 1 Admin chính và 7 mật khẩu cho 7 Leader tương ứng 7 Team
const PASSWORDS = {
  admin: process.env.ADMIN_PASSWORD || 'DHPT280116',
  'Team 1': 'leader123q',
  'Team 2': 'leader234w',
  'Team 3': 'leader345e',
  'Team 4': 'leader456r',
  'Team 5': 'leader567t',
  'Team 6': 'leader678y',
  'Team 7': 'leader789u'
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Kết nối MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Đã kết nối MongoDB Atlas thành công'))
  .catch(err => console.error('❌ Lỗi kết nối MongoDB:', err));

// Middleware xác thực và phân quyền (Admin hoặc Leader)
const verifyAuth = (req, res, next) => {
  const password = req.headers['x-admin-password'] || req.body.adminPassword;
  if (!password) {
    return res.status(401).json({ success: false, message: 'Chưa cung cấp mật khẩu đăng nhập!' });
  }

  if (password === PASSWORDS.admin) {
    req.userRole = 'admin';
    return next();
  }

  for (let teamName in PASSWORDS) {
    if (teamName !== 'admin' && PASSWORDS[teamName] === password) {
      req.userRole = 'leader';
      req.userTeam = teamName;
      return next();
    }
  }

  res.status(401).json({ success: false, message: 'Mật khẩu không hợp lệ!' });
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

// API gợi ý/đề xuất tên TNV khi gõ
app.get('/api/volunteers/search-names', async (req, res) => {
  try {
    const { term } = req.query;
    if (!term || term.trim().length === 0) return res.json({ success: true, data: [] });

    const list = await Volunteer.find({
      fullName: { $regex: term.trim(),$options: 'i' },
      status: 'approved'
    }).select('fullName mssv team').limit(10);

    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Form 1: Khởi tạo TNV (Nếu đã có MSSV thì cập nhật lại Tên và Team, giữ nguyên dữ liệu cũ)
app.post('/api/volunteers/register', async (req, res) => {
  try {
    const { fullName, mssv, team } = req.body;
    if (!fullName || !mssv || !team) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập đầy đủ Họ tên, MSSV và chọn Team!' });
    }

    let volunteer = await Volunteer.findOne({ mssv: mssv.trim().toUpperCase() });
    if (volunteer) {
      // Ghi đè cập nhật lại tên và team, giữ nguyên các dữ liệu lịch sử cũ
      volunteer.fullName = fullName.trim();
      volunteer.team = team;
      await volunteer.save();
      return res.json({ success: true, message: 'Sinh viên đã có trong hệ thống! Đã cập nhật lại thông tin và Team thành công mà không làm mất dữ liệu cũ.' });
    }

    volunteer = new Volunteer({
      fullName: fullName.trim(),
      mssv: mssv.trim().toUpperCase(),
      team: team,
      status: 'pending'
    });
    await volunteer.save();
    res.json({ success: true, message: 'Đăng ký thành công! Đang chờ phê duyệt.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Form 2: Ghi nhận hoặc Sửa tên buổi tình nguyện (Mỗi ngày tự ghi nhận tối đa 1 buổi)
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

    const existingActivityIndex = volunteer.activities.findIndex(act => act.date === date);

    if (existingActivityIndex !== -1) {
      volunteer.activities[existingActivityIndex].content = content.trim();
      await volunteer.save();
      return res.json({ 
        success: true, 
        message: 'Bạn đã có ghi nhận trong ngày này! Hệ thống đã tự động cập nhật/sửa lại tên buổi tình nguyện cho bạn.' 
      });
    } else {
      volunteer.activities.push({ content: content.trim(), date });
      await volunteer.save();
      return res.json({ success: true, message: 'Ghi nhận buổi tình nguyện thành công!' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Form 3: Cập nhật Vi phạm / Ghi chú / Thành tích (Leader chỉ được thao tác thành viên team mình)
app.post('/api/volunteers/admin-update', verifyAuth, async (req, res) => {
  try {
    const { mssv, fullName, updateType, valueData } = req.body;
    let query = { status: 'approved' };

    if (req.userRole === 'leader') {
      query.team = req.userTeam;
    }

    if (!fullName && !mssv) {
      return res.status(400).json({ success: false, message: 'Vui lòng nhập Họ tên hoặc MSSV!' });
    }

    if (mssv && mssv.trim()) {
      query.mssv = mssv.trim().toUpperCase();
    } else if (fullName && fullName.trim()) {
      query.fullName = { $regex: new RegExp(`^${fullName.trim()}$`, 'i') };
      const matches = await Volunteer.find(query);

      if (matches.length === 0) {
        return res.status(404).json({ success: false, message: 'Không tìm thấy TNV phù hợp trong phạm vi quản lý!' });
      }
      if (matches.length > 1) {
        return res.status(400).json({ 
          success: false, 
          requireMssv: true,
          message: `Phát hiện ${matches.length} sinh viên trùng tên "${fullName}". Vui lòng nhập thêm MSSV!` 
        });
      }
      query._id = matches[0]._id;
      delete query.fullName;
    }

    const volunteer = await Volunteer.findOne(query);
    if (!volunteer) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin TNV hoặc không thuộc quyền quản lý!' });
    }

    if (updateType === 'fault') {
      volunteer.faults.push({ fault: valueData.fault, date: valueData.date });
    } else if (updateType === 'note') {
      if (typeof volunteer.notes === 'undefined') volunteer.notes = [];
      volunteer.notes.push({ text: valueData.generalNote.trim(), createdAt: new Date() });
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

// --- API DASHBOARD ADMIN & LEADER ---

app.post('/api/admin/volunteers', verifyAuth, async (req, res) => {
  try {
    let query = {};
    if (req.userRole === 'leader') {
      query.team = req.userTeam;
    }

    const list = await Volunteer.find(query).sort({ createdAt: -1 });
    
    // Tính tổng số buổi họp của toàn đội để làm chuẩn tính phần trăm
    const allVolunteers = await Volunteer.find({});
    let meetingDatesSet = new Set();
    allVolunteers.forEach(v => {
      (v.attendance || []).forEach(att => meetingDatesSet.add(att.date));
    });
    const totalMeetingsInTerm = meetingDatesSet.size || 1;

    const processed = list.map(v => {
      let obj = v.toObject();
      const groupMap = {};
      (obj.activities || []).forEach(act => {
        const key = normalizeActivityContent(act.content);
        if (!groupMap[key]) groupMap[key] = { groupName: act.content, count: 0, items: [] };
        groupMap[key].count += 1;
        groupMap[key].items.push(act);
      });
      obj.activitySummary = Object.values(groupMap);

      // Tính phần trăm buổi họp
      const attendedCount = (obj.attendance || []).filter(a => a.present).length;
      obj.meetingPercentage = Math.round((attendedCount / totalMeetingsInTerm) * 100);

      return obj;
    });

    res.json({ 
      success: true, 
      role: req.userRole, 
      userTeam: req.userTeam || null,
      data: processed 
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/approve', verifyAuth, async (req, res) => {
  try {
    const { id, action } = req.body;
    const volunteer = await Volunteer.findById(id);
    if (!volunteer) return res.status(404).json({ success: false, message: 'Không tìm thấy TNV!' });

    if (req.userRole === 'leader' && volunteer.team !== req.userTeam) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền duyệt TNV của team khác!' });
    }

    if (action === 'approve') {
      volunteer.status = 'approved';
      await volunteer.save();
      res.json({ success: true, message: 'Đã phê duyệt tình nguyện viên!' });
    } else if (action === 'reject') {
      await Volunteer.findByIdAndDelete(id);
      res.json({ success: true, message: 'Đã từ chối và xóa hồ sơ!' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API Điểm danh họp đội
app.post('/api/admin/attendance', verifyAuth, async (req, res) => {
  try {
    const { date, attendanceList } = req.body;
    if (!date || !attendanceList) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin ngày hoặc danh sách điểm danh!' });
    }

    for (let item of attendanceList) {
      let query = { mssv: item.mssv.trim().toUpperCase() };
      if (req.userRole === 'leader') query.team = req.userTeam;

      let volunteer = await Volunteer.findOne(query);
      if (volunteer) {
        let attIndex = volunteer.attendance.findIndex(a => a.date === date);
        if (attIndex !== -1) {
          volunteer.attendance[attIndex].present = item.present;
        } else {
          volunteer.attendance.push({ date, present: item.present });
        }
        await volunteer.save();
      }
    }

    res.json({ success: true, message: 'Điểm danh họp đội thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// API MỚI: Xóa toàn bộ dữ liệu điểm danh của một ngày cụ thể (Dành cho trường hợp Leader nhập nhầm ngày)
app.post('/api/admin/delete-attendance-date', verifyAuth, async (req, res) => {
  try {
    const { date } = req.body;
    if (!date) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin ngày cần xóa!' });
    }

    let query = {};
    if (req.userRole === 'leader') {
      query.team = req.userTeam;
    }

    // Sử dụng toán tử $pull để loại bỏ mảng attendance có ngày khớp
    await Volunteer.updateMany(query, {
      $pull: { attendance: { date: date } }
    });

    res.json({ success: true, message: `Đã xóa thành công dữ liệu điểm danh của ngày ${date}!` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Xóa lẻ mục (hoạt động, lỗi, chiến dịch, GHI CHÚ BULLET, GHI CHÚ ĐƠN CŨ)
app.post('/api/admin/delete-item', verifyAuth, async (req, res) => {
  try {
    const { volunteerId, itemType, itemId } = req.body;
    const volunteer = await Volunteer.findById(volunteerId);
    if (!volunteer) return res.status(404).json({ success: false, message: 'Không tìm thấy TNV!' });

    if (req.userRole === 'leader' && volunteer.team !== req.userTeam) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền chỉnh sửa thành viên team khác!' });
    }

    let updateQuery = {};
    if (itemType === 'activity') updateQuery = { $pull: { activities: { _id: itemId } } };
    if (itemType === 'fault') updateQuery = { $pull: { faults: { _id: itemId } } };
    if (itemType === 'campaign') updateQuery = { $pull: { campaigns: { _id: itemId } } };
    if (itemType === 'note') updateQuery = { $pull: { notes: { _id: itemId } } };
    if (itemType === 'generalNote') updateQuery = { $set: { generalNote: '' } };

    await Volunteer.findByIdAndUpdate(volunteerId, updateQuery);
    res.json({ success: true, message: 'Đã xóa mục thành công!' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
