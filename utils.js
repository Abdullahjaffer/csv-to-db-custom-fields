const promisedQuery = (con, sql, values) => {
  return new Promise((resolve, reject) => {
    con.query(sql, values, (err, ...params) => {
      if (err) {
        reject(err);
      }
      resolve(params);
    });
  });
};

const promisedSelectQuery = (con, sql) => {
  return new Promise((resolve, reject) => {
    con.query(sql, (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    });
  });
};

module.exports = { promisedQuery, promisedSelectQuery };
