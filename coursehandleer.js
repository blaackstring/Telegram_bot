const { User } = require("./model");

const courseHandler = async (chatid, sem, course) => {
  try {
    let user = await User.findOne({ userid: chatid });

    if (!user) {
      // 🆕 Create and save new user
      user = new User({
        userid: chatid,
        course,
        sem
      });
      await user.save();
      console.log(`✅ New user created with chatId ${chatid}`);
    } else {
      // 🛠️ Update sem or course if either changed
      let updated = false;

      if (sem && user.sem !== sem) {
        user.sem = sem;
        updated = true;
      }

      if (course && user.course !== course) {
        user.course = course;
        updated = true;
      }

      if (updated) {
        await user.save();
        console.log(`✅ User updated: ${chatid}, sem: ${user.sem}, course: ${user.course}`);
      } else {
        console.log(`ℹ️ No update needed for chatId ${chatid}`);
      }
    }
  } catch (error) {
    console.error('❌ Error in courseHandler:', error);
  }
};

module.exports = { courseHandler };
