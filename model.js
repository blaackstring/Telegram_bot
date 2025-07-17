const mongoose=require('mongoose')

const userSchema=new mongoose.Schema({
  userid:{
    type:String,
    required:true,
    unique:true
  },
  course:{
    type:String,
    required:true
  },
  sem:{
    type:String,
    required:true
  }
})
const User = mongoose.models.User || mongoose.model('User', userSchema);

module.exports={User}
